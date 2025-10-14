import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';

// Fix: Define types for the Web Speech API's SpeechRecognition to resolve TypeScript errors.
interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
  onresult: ((event: any) => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognition;

// Polyfill for browsers that use webkit prefix for SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor;
    webkitSpeechRecognition: SpeechRecognitionConstructor;
  }
}

type Memory = {
  id: number;
  title: string;
  query: string;
  category: string;
  imageStyle: string;
  resultText: string;
  imageUrl: string;
};

type SharedMemoryData = Omit<Memory, 'id' | 'imageUrl'>;


const App = () => {
  const [query, setQuery] = useState('');
  const [resultText, setResultText] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('general');
  const [imageStyle, setImageStyle] = useState('faded-photo');
  
  const [title, setTitle] = useState('');
  const [tempTitle, setTempTitle] = useState('');
  const [isTitleSet, setIsTitleSet] = useState(false);
  const [showShareFallback, setShowShareFallback] = useState(false);
  const [history, setHistory] = useState<Memory[]>([]);
  const [isLoadingShared, setIsLoadingShared] = useState(true);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [highlightedWordIndex, setHighlightedWordIndex] = useState(-1);
  
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const originalQueryRef = useRef('');

  const [fontStyle, setFontStyle] = useState('font-serif');
  const [fontSize, setFontSize] = useState(1.1); // in rem

  const resultSectionRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  
  // Cleanup speech synthesis on component unmount
  useEffect(() => {
    return () => {
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
      }
    };
  }, []);
  
  // Setup Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0])
        .map((result) => result.transcript)
        .join('');
      setQuery(originalQueryRef.current + transcript);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, []);

  useEffect(() => {
    // Check for shared memory on initial load
    const handleSharedMemory = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const sharedData = urlParams.get('memory');
        if (sharedData) {
            try {
                const decodedData: SharedMemoryData = JSON.parse(atob(decodeURIComponent(sharedData)));
                setQuery(decodedData.query);
                setResultText(decodedData.resultText);
                setTitle(decodedData.title);
                setCategory(decodedData.category);
                setImageStyle(decodedData.imageStyle);
                setIsTitleSet(true);
                
                // Regenerate image
                setLoading(true);
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                const { imagePrompt } = getPrompts(decodedData.category, decodedData.query, decodedData.imageStyle);
                const imageResponse = await ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: imagePrompt,
                    config: {
                        numberOfImages: 2,
                        outputMimeType: 'image/jpeg',
                        aspectRatio: '16:9',
                    },
                });
                
                const generatedImageUrls = imageResponse.generatedImages.map(
                    img => `data:image/jpeg;base64,${img.image.imageBytes}`
                );
                setImageUrls(generatedImageUrls);
                setActiveImageIndex(0);
                setLoading(false);

                // Clean up URL
                window.history.replaceState({}, document.title, window.location.pathname);

            } catch (err) {
                console.error("Failed to parse or load shared memory", err);
                setError("Paylaşılan anı yüklenirken bir sorun oluştu.");
            }
        }
        setIsLoadingShared(false);
    };

    handleSharedMemory();

    // Load history from localStorage
    try {
      const savedHistory = localStorage.getItem('aniMakinesiHistory');
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch (error) {
      console.error("Could not load history from localStorage", error);
      localStorage.removeItem('aniMakinesiHistory');
    }
  }, []);
  
  useEffect(() => {
    // Automatically focus the title input when it appears
    if (resultText && !isTitleSet && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [resultText, isTitleSet]);

  useEffect(() => {
    // Automatically scroll to the result section when it's generated or loaded
    if (resultText && !loading && resultSectionRef.current) {
      const timer = setTimeout(() => {
         resultSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [resultText, loading]);
  
  useEffect(() => {
    // Switch to the second image after 4 seconds for a newly generated memory
    if (imageUrls.length > 1 && activeImageIndex === 0) {
        const timer = setTimeout(() => {
            setActiveImageIndex(1);
        }, 4000);
        return () => clearTimeout(timer); // Cleanup timer
    }
  }, [imageUrls, activeImageIndex]);

  const categories = {
    general: 'Genel Anı',
    cartoon: 'Çizgi Film Sahnesi',
    series: 'Dizi Karesi',
    clip: 'Şarkı Klibi',
    dream: 'Rüya Sahnesi',
    fairytale: 'Masal İllüstrasyonu',
    scifi: 'Bilim Kurgu Konsepti',
  };

  const styles = {
    'faded-photo': 'Soluk Fotoğraf',
    watercolor: 'Suluboya',
    sketch: 'Eskiz',
    'oil-painting': 'Yağlı Boya',
    'pixel-art': 'Pixel Art',
    '3d-render': '3D Render',
    'vintage-poster': 'Vintage Poster',
  };
    
  const nostalgicSuggestions = [
    'atari', 'Barış Manço', 'beslenme çantası', 'Bizimkiler', 'Cino çikolata', 
    'disket', 'hulahop', 'kaset', 'kaykay', 'kokulu silgi', 'leblebi tozu', 
    'mahalle maçı', 'meybuz', 'misket', 'patlayan şeker', 'sanal bebek', 'sega', 
    'sulugöz sakız', 'Süper Baba', 'taso', 'tetris', 'TipiTip sakız', 'walkman', 
    'yumiyum'
  ];

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(prevQuery => prevQuery ? `${prevQuery}, ${suggestion}` : suggestion);
  };
  
  // A single, robust way to split the text into renderable and trackable parts.
  // Each part is a word plus any trailing whitespace. e.g., ["Merhaba ", "dünya.  "]
  const textParts = useMemo(() => {
    if (!resultText) return [];
    return resultText.match(/\S+\s*/g) || [];
  }, [resultText]);

  // Creates a map of each text part to its starting character index for highlighting.
  const wordMap = useMemo(() => {
    if (!textParts.length) return [];
    
    let charCount = 0;
    return textParts.map(part => {
      const map = { word: part, startIndex: charCount };
      charCount += part.length;
      return map;
    });
  }, [textParts]);

  const getPrompts = (selectedCategory: string, userQuery: string, selectedStyle: string) => {
    const baseTextPrompt = `Kullanıcının şu kelimelerinden yola çıkarak 90'lar Türkiye'sindeki bir çocukluk anısını anlatan, kısa, şiirsel ve nostaljik bir metin yaz: "${userQuery}". Tonu sıcak, biraz hüzünlü ve rüya gibi olsun.`;
    let textPrompt = '';
    switch (selectedCategory) {
      case 'cartoon':
        textPrompt = `${baseTextPrompt} Bu anıyı, sanki 90'ların pastel tonlu, iç ısıtan bir çizgi filminin unutulmuş bir sahnesi gibi anlat.`;
        break;
      case 'series':
        textPrompt = `${baseTextPrompt} Bu anıyı, 90'lar yapımı bir Türk aile dizisinin sıcak bir sahnesi gibi, o dönemin diyaloglarına benzer bir naiflikle anlat.`;
        break;
      case 'clip':
        textPrompt = `${baseTextPrompt} Bu anıyı, 90'lar Türkçe pop müziği video klibinin şiirsel ve biraz da absürt bir sahnesi gibi anlat.`;
        break;
      case 'dream':
        textPrompt = `${baseTextPrompt} Bu anıyı, gerçeküstü ve sembolik imgelerle dolu bir rüya sahnesi gibi anlat.`;
        break;
      case 'fairytale':
        textPrompt = `${baseTextPrompt} Bu anıyı, sanki eski bir masal kitabından fırlamış, büyülü bir illüstrasyonun hikayesi gibi anlat.`;
        break;
      case 'scifi':
        textPrompt = `${baseTextPrompt} Bu anıyı, 90'ların retro-fütüristik bir bilim kurgu konsept çizimi gibi, o dönemin gelecek tasavvurunu yansıtarak anlat.`;
        break;
      case 'general':
      default:
        textPrompt = `${baseTextPrompt} Sanki eski bir anı günlüğünden bir parça gibi hissettirsin.`;
        break;
    }

    let imagePrompt = `A dream-like, nostalgic, and slightly surreal image representing a Turkish childhood memory about "${userQuery}". Avoid clear faces. Capture the feeling and atmosphere. No text.`;

    switch (selectedCategory) {
      case 'cartoon':
        imagePrompt += " The scene should feel like a vintage 90s animation cel from a classic, gentle cartoon. Use soft, pastel colors.";
        break;
      case 'series':
        imagePrompt += " The scene should look like a cinematic still from a 90s Turkish television drama. Slightly grainy with warm color grading.";
        break;
      case 'clip':
        imagePrompt += " The scene must emulate the aesthetic of a 90s Turkish pop music video: dreamy, slightly surreal, with soft focus and lens flares.";
        break;
      case 'dream':
        imagePrompt += " The scene should be highly surreal, symbolic, and dream-like, with illogical connections and a hazy, ethereal quality.";
        break;
      case 'fairytale':
        imagePrompt += " The scene should look like a beautiful, classic fairy tale book illustration, with enchanting details and a magical atmosphere.";
        break;
      case 'scifi':
        imagePrompt += " The scene should be a piece of retro-futuristic sci-fi concept art from the 90s. Imagine technology and daily life as envisioned in that era, with chunky hardware, neon glows, and a slightly analog feel.";
        break;
    }

    switch (selectedStyle) {
      case 'watercolor':
        imagePrompt += " Render this scene in the style of a soft, expressive watercolor painting.";
        break;
      case 'sketch':
        imagePrompt += " Render this scene as a nostalgic, hand-drawn pencil sketch on textured paper.";
        break;
      case 'oil-painting':
        imagePrompt += " Render this scene as a classic, textured oil painting with visible brushstrokes.";
        break;
      case 'pixel-art':
        imagePrompt += " Render this scene as vibrant, detailed 16-bit pixel art, in the style of a classic 90s video game.";
        break;
      case '3d-render':
        imagePrompt += " Render this scene as an early 90s 3D render, with simple geometry, basic lighting, and a slightly plastic-like texture.";
        break;
      case 'vintage-poster':
        imagePrompt += " Render this scene as a vintage poster from the 1990s, with bold graphic elements and a retro color palette. Avoid any legible text.";
        break;
      case 'faded-photo':
      default:
        imagePrompt += " The final image must have the look of a warm, retro, faded photograph from the 90s.";
        break;
    }

    return { textPrompt, imagePrompt };
  };

  const handleToggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      originalQueryRef.current = query.trim() ? query.trim() + ' ' : '';
      recognitionRef.current.start();
    }
  };

  const handleGenerate = async () => {
    if (!query.trim() || loading) return;
    
    handleStartNew(false); // Clear state without scrolling
    setLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const { textPrompt, imagePrompt } = getPrompts(category, query, imageStyle);
      
      const textPromise = ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: textPrompt,
      });

      const imagePromise = ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: imagePrompt,
        config: {
          numberOfImages: 2,
          outputMimeType: 'image/jpeg',
          aspectRatio: '16:9',
        },
      });

      const [textResponse, imageResponse] = await Promise.all([textPromise, imagePromise]);

      setResultText(textResponse.text);

      const generatedImageUrls = imageResponse.generatedImages.map(
        img => `data:image/jpeg;base64,${img.image.imageBytes}`
      );
      setImageUrls(generatedImageUrls);
      setActiveImageIndex(0);

    } catch (err) {
      console.error(err);
      setError('Anı canlandırılırken bir sorun oluştu. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetTitle = () => {
    if (tempTitle.trim()) {
        const newTitle = tempTitle.trim();
        setTitle(newTitle);
        setIsTitleSet(true);

        const newMemory: Memory = {
            id: Date.now(),
            title: newTitle,
            query,
            category,
            imageStyle,
            resultText,
            imageUrl: imageUrls[0], // Save only the first image
        };
        
        setHistory(prevHistory => {
            const updatedHistory = [newMemory, ...prevHistory];
            try {
                localStorage.setItem('aniMakinesiHistory', JSON.stringify(updatedHistory));
            } catch (error) {
                console.error("Could not save history to localStorage", error);
            }
            return updatedHistory;
        });
    }
  };
  
  const dataURLtoFile = (dataurl: string, filename: string) => {
    const arr = dataurl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch) return null;
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };
  
  const handleShare = async () => {
    const shareText = `${title}\n\n${resultText}`;
  
    if (navigator.share && imageUrls.length > 0) {
      try {
        const imageFile = dataURLtoFile(imageUrls[activeImageIndex], 'ani-makinesi.jpeg');
        if (imageFile && navigator.canShare && navigator.canShare({ files: [imageFile] })) {
          await navigator.share({
            title: `Anı Makinesi: ${title}`,
            text: shareText,
            files: [imageFile],
          });
        } else {
          await navigator.share({
            title: `Anı Makinesi: ${title}`,
            text: shareText,
          });
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Sharing failed:', error);
          setShowShareFallback(true);
        }
      }
    } else {
      setShowShareFallback(true);
    }
  };

  const copyTextToClipboard = async () => {
    const shareText = `${title}\n\n${resultText}`;
    try {
      await navigator.clipboard.writeText(shareText);
      alert('Metin panoya kopyalandı!');
    } catch (err) {
      console.error('Metin kopyalanamadı:', err);
      alert('Hata: Metin kopyalanamadı.');
    }
  };

  const downloadImage = () => {
    const link = document.createElement('a');
    link.href = imageUrls[activeImageIndex];
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `${safeTitle || 'ani_makinesi'}.jpeg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyLink = () => {
    const dataToShare: SharedMemoryData = {
        title,
        resultText,
        query,
        category,
        imageStyle
    };
    const base64Data = btoa(JSON.stringify(dataToShare));
    const url = `${window.location.origin}${window.location.pathname}?memory=${encodeURIComponent(base64Data)}`;
    navigator.clipboard.writeText(url).then(() => {
        alert('Paylaşım linki panoya kopyalandı!');
        setShowShareFallback(false);
    }).catch(err => {
        console.error('Link kopyalanamadı:', err);
        alert('Hata: Link kopyalanamadı.');
    });
  };

  const loadMemoryFromHistory = (memory: Memory) => {
    if (speechSynthesis.speaking) speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setHighlightedWordIndex(-1);
    
    setQuery(memory.query);
    setResultText(memory.resultText);
    setImageUrls([memory.imageUrl]);
    setActiveImageIndex(0);
    setTempTitle(memory.title);
    setCategory(memory.category);
    setImageStyle(memory.imageStyle);
    
    setIsTitleSet(false);
    setLoading(false);
    setError('');
    setShowShareFallback(false);
    setTitle('');
  };

  const handleStartNew = (shouldScroll = true) => {
    if (speechSynthesis.speaking) speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setHighlightedWordIndex(-1);
    setQuery('');
    setResultText('');
    setImageUrls([]);
    setActiveImageIndex(0);
    setTitle('');
    setTempTitle('');
    setIsTitleSet(false);
    setError('');
    setShowShareFallback(false);
    if(shouldScroll) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  
  const handlePlayToggle = () => {
    if (!resultText) return;

    if (isSpeaking && !isPaused) { // Speaking -> Pause
        speechSynthesis.pause();
        setIsPaused(true);
    } else if (isSpeaking && isPaused) { // Paused -> Resume
        speechSynthesis.resume();
        setIsPaused(false);
    } else { // Not speaking -> Start
        speechSynthesis.cancel(); 
        const utterance = new SpeechSynthesisUtterance(resultText);
        
        const voices = speechSynthesis.getVoices();
        const turkishVoice = voices.find(voice => voice.lang === 'tr-TR' && voice.name.includes('Yelda')) || voices.find(voice => voice.lang === 'tr-TR');
        
        if (turkishVoice) {
            utterance.voice = turkishVoice;
        }
        utterance.pitch = 0.9;
        utterance.rate = 0.9;

        utterance.onboundary = (event) => {
            const charIndex = event.charIndex;
            let currentWordIndex = -1;
            for (let i = 0; i < wordMap.length; i++) {
                if (wordMap[i].startIndex <= charIndex) {
                    currentWordIndex = i;
                } else {
                    break;
                }
            }
            if (currentWordIndex !== -1) {
                setHighlightedWordIndex(currentWordIndex);
            }
        };

        utterance.onstart = () => {
            setIsSpeaking(true);
            setIsPaused(false);
            setHighlightedWordIndex(0);
        };

        utterance.onend = () => {
            setIsSpeaking(false);
            setIsPaused(false);
            setHighlightedWordIndex(-1);
        };
        
        utterance.onerror = (event) => {
            console.error('SpeechSynthesis Error', event);
            setIsSpeaking(false);
            setIsPaused(false);
            setHighlightedWordIndex(-1);
            setError("Seslendirme sırasında bir hata oluştu.");
        };

        speechSynthesis.speak(utterance);
    }
  };


  if (isLoadingShared) {
      return (
        <div className="container">
          <div className="initial-loading">
            <div className="button-spinner"></div>
            <p>Anılar yükleniyor...</p>
          </div>
        </div>
      );
  }

  return (
    <div className="container">
     {!resultText && !loading && (
      <>
      <header>
        <h1>Anı Makinesi</h1>
        <p>Çocukluğundan aklında kalan birkaç kelime yaz, anının türünü ve stilini seç, sihrin gerçekleşmesini bekle.</p>
      </header>
      <div className="input-section">
        <div className="category-selector">
          {Object.entries(categories).map(([key, value]) => (
            <button
              key={key}
              className={`category-btn ${category === key ? 'active' : ''}`}
              onClick={() => setCategory(key)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="category-selector">
          {Object.entries(styles).map(([key, value]) => (
            <button
              key={key}
              className={`category-btn ${imageStyle === key ? 'active' : ''}`}
              onClick={() => setImageStyle(key)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="input-wrapper">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Örn: bayram sabahı, misket, leblebi tozu..."
            rows={3}
            aria-label="Anı canlandırmak için kelimeler"
          />
          <button
            type="button"
            onClick={handleToggleListening}
            className={`voice-input-btn ${isListening ? 'listening' : ''}`}
            disabled={!recognitionRef.current}
            aria-label={isListening ? 'Ses girişini durdur' : 'Sesle yazdır'}
            title={recognitionRef.current ? (isListening ? 'Durdur' : 'Sesle Yazdır') : 'Ses tanıma desteklenmiyor'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-480Zm0 280q-83 0-141.5-58.5T280-400h80q0 50 35 85t85 35q50 0 85-35t35-85h80q0 83-58.5 141.5T480-200Zm0-320Z"/></svg>
          </button>
        </div>
        <div className="suggestions-section">
            <h3 className="suggestions-title">İlham Al</h3>
            <div className="suggestions-list">
                {nostalgicSuggestions.map(suggestion => (
                    <button key={suggestion} className="suggestion-tag" onClick={() => handleSuggestionClick(suggestion)}>
                        {suggestion}
                    </button>
                ))}
            </div>
        </div>
        <button onClick={handleGenerate} disabled={loading || !query.trim()} className="generate-button">
          {loading ? (
            <>
              <div className="button-spinner"></div>
              <span>Anılar Canlanıyor...</span>
            </>
          ) : (
            'Anıyı Canlandır'
          )}
        </button>
      </div>
      </>
     )}
      
      <div className="output-container">
        {loading && (
           <div className="image-placeholder" aria-label="Görsel oluşturuluyor..." role="status">
               <div className="shimmer-effect"></div>
           </div>
        )}

        {error && <p className="error">{error}</p>}

        {(resultText || imageUrls.length > 0) && !loading && (
          <div className="result-section" ref={resultSectionRef}>
              {imageUrls.length > 0 && (
                  <div className="image-container">
                      {imageUrls.map((url, index) => (
                        <img
                          key={index}
                          src={url}
                          alt={`Oluşturulan anı görseli: ${query}`}
                          className={`result-image ${index === activeImageIndex ? 'visible' : ''} ${index === 0 ? 'zoom-out-effect' : 'zoom-in-effect'}`}
                        />
                      ))}
                  </div>
              )}
              {resultText && (
                <div className="text-content">
                  {!isTitleSet ? (
                    <div className="title-prompt">
                      <input
                        ref={titleInputRef}
                        type="text"
                        value={tempTitle}
                        onChange={(e) => setTempTitle(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSetTitle();
                        }}
                        placeholder="Bu anıya bir başlık ver..."
                        aria-label="Anı için başlık"
                      />
                      <button onClick={handleSetTitle}>Kaydet</button>
                    </div>
                  ) : (
                    <div className="title-and-actions">
                      <h2 className="memory-title">{title}</h2>
                      <div className="actions-cluster">
                        <button onClick={() => handleStartNew()} className="action-button main-menu-button" aria-label="Ana menüye dön">
                           <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Zm320-350Z"/></svg>
                           Ana Menü
                        </button>
                        <button onClick={handleShare} className="action-button share-button" aria-label="Anıyı Paylaş">
                          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M720-80q-50 0-85-35t-35-85q0-7 1-14.5t3-13.5L322-392q-17 15-38 23.5T240-360q-50 0-85-35t-35-85q0-50 35-85t85-35q21 0 42 8.5t38 23.5l282-164q-2-6-3-13.5t-1-14.5q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-21 0-42-8.5T640-692L358-528q2 6 3 13.5t1 14.5q0 7-1 14.5t-3 13.5l282 164q17-15 38-23.5t42-8.5q50 0 85 35t35 85q0 50-35 85t-85 35Z"/></svg>
                          Paylaş
                        </button>
                      </div>
                    </div>
                  )}
                   <div className="memory-context">
                    <p><strong>Hatırlanan Kelimeler:</strong> {query}</p>
                    <p><strong>Tür:</strong> {categories[category]} &bull; <strong>Stil:</strong> {styles[imageStyle]}</p>
                  </div>
                  <button
                    onClick={handlePlayToggle}
                    className="voiceover-button"
                    aria-label={isSpeaking && !isPaused ? "Duraklat" : (isPaused ? "Devam Et" : "Anıyı Seslendir")}
                  >
                    {isSpeaking && !isPaused ? (
                      <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M520-200v-560h160v560H520Zm-280 0v-560h160v560H240Z"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M320-200v-560l440 280-440 280Z"/></svg>
                    )}
                    <span>{isSpeaking && !isPaused ? "Duraklat" : (isPaused ? "Devam Et" : "Anıyı Seslendir")}</span>
                  </button>
                  <div className="font-controls">
                    <div className="font-style-selector">
                        <button onClick={() => setFontStyle('font-serif')} className={fontStyle === 'font-serif' ? 'active' : ''} aria-label="Serif yazı tipi">Serif</button>
                        <button onClick={() => setFontStyle('font-sans-serif')} className={fontStyle === 'font-sans-serif' ? 'active' : ''} aria-label="Sans-serif yazı tipi">Sans-Serif</button>
                        <button onClick={() => setFontStyle('font-script')} className={fontStyle === 'font-script' ? 'active' : ''} aria-label="El yazısı tipi">El Yazısı</button>
                    </div>
                    <div className="font-size-controls">
                        <button onClick={() => setFontSize(s => Math.max(0.8, s - 0.1))} aria-label="Yazı tipini küçült">A-</button>
                        <button onClick={() => setFontSize(s => Math.min(2.0, s + 0.1))} aria-label="Yazı tipini büyüt">A+</button>
                    </div>
                  </div>
                  <p className={`result-text ${fontStyle}`} style={{ fontSize: `${fontSize}rem` }}>
                    {textParts.map((part, index) => (
                        <span key={index} className={index === highlightedWordIndex ? 'word-highlight' : 'word'}>
                            {part}
                        </span>
                    ))}
                  </p>
                </div>
              )}
          </div>
        )}
      </div>

      {showShareFallback && (
        <div className="share-modal-overlay" onClick={() => setShowShareFallback(false)}>
          <div className="share-modal" onClick={e => e.stopPropagation()}>
            <h3>Anıyı Paylaş</h3>
            <p>Aşağıdaki seçenekleri kullanarak anını arkadaşlarınla paylaşabilirsin:</p>
            <div className="share-modal-actions">
                <button onClick={handleCopyLink}>Linki Kopyala</button>
                <button onClick={copyTextToClipboard}>Metni Kopyala</button>
                <button onClick={downloadImage}>Görseli İndir</button>
            </div>
            <button className="close-modal-btn" onClick={() => setShowShareFallback(false)}>Kapat</button>
          </div>
        </div>
      )}

      {history.length > 0 && !resultText && !loading && (
        <div className="history-section">
          <h2>Geçmiş Anılarım</h2>
          <div className="history-list">
            {history.map(mem => (
              <div 
                key={mem.id} 
                className="history-item" 
                onClick={() => loadMemoryFromHistory(mem)} 
                tabIndex={0} 
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') loadMemoryFromHistory(mem) }}
                role="button"
                aria-label={`Yükle: ${mem.title}`}
              >
                <img src={mem.imageUrl} alt={mem.title} className="history-item-image" loading="lazy" />
                <div className="history-item-overlay">
                  <p className="history-item-title">{mem.title}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);