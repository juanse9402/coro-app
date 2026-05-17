import React, { useState, useEffect, useRef } from 'react';
import { Search, Mic, Sun, Moon, Monitor, Music, Guitar, Drum, ArrowLeft, Plus, Minus, Play, Pause, ChevronDown, Maximize, Minimize, ListPlus, ListOrdered, X, GripVertical, ChevronLeft, ChevronRight, CloudOff, CloudCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Papa from 'papaparse';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function transposeChord(chord, steps) {
  const match = chord.match(/^([CDEFGAB][#b]?)(.*)$/);
  if (!match) return chord;
  let [_, base, mod] = match;
  const flatToSharp = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };
  if (flatToSharp[base]) base = flatToSharp[base];
  let index = NOTES.indexOf(base);
  if (index === -1) return chord;
  let newIndex = (index + steps) % 12;
  if (newIndex < 0) newIndex += 12;
  if (mod.includes('/')) {
    const [m, bass] = mod.split('/');
    return `${NOTES[newIndex]}${m}/${transposeChord(bass, steps)}`;
  }
  return `${NOTES[newIndex]}${mod}`;
}

export default function App() {
  const [theme, setTheme] = useState('stage');
  const [instrument, setInstrument] = useState('guitar'); 
  const [searchQuery, setSearchQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [songs, setSongs] = useState([]);
  const [selectedSong, setSelectedSong] = useState(null);
  const [transposeSteps, setTransposeSteps] = useState(0);
  const [scrollStatus, setScrollStatus] = useState('idle'); // idle, preroll, scrolling
  const [scrollMultiplier, setScrollMultiplier] = useState(1.0);
  const [prerollCount, setPrerollCount] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const [aiToast, setAiToast] = useState('');
  const [syncStatus, setSyncStatus] = useState('loading'); // loading, synced, offline

  // Setlist states
  const [setlist, setSetlist] = useState([]);
  const [showSetlist, setShowSetlist] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState(null);

  useEffect(() => {
    // 1. Carga Local Rápida (Offline-first)
    const localData = localStorage.getItem('coro_songs');
    if (localData) {
      try {
        setSongs(JSON.parse(localData));
        setSyncStatus('offline');
      } catch (e) {
        console.error("Local data corrupted", e);
      }
    }

    // 2. Fetch remoto para sincronizar en background
    const sheetUrl = import.meta.env.VITE_GOOGLE_SHEETS_CSV_URL || 'https://docs.google.com/spreadsheets/d/1RmJvERvRZjH-TKOquyOBwyMmWsZ8PqKdxDIhc7Ov_vk/export?format=csv';
    Papa.parse(sheetUrl, {
      download: true,
      header: true,
      complete: (results) => {
        const parsedSongs = results.data
          .filter(r => r.Título)
          .map(row => ({
            id: row.ID,
            title: row.Título,
            tone: row.Tono,
            bpm: parseInt(row.BPM) || 100,
            category: row.Categoría,
            content: row['Contenido (Letra y Acordes para IA)'] || ''
          }));
        setSongs(parsedSongs);
        localStorage.setItem('coro_songs', JSON.stringify(parsedSongs));
        setSyncStatus('synced');
      },
      error: () => {
        if (localData) setSyncStatus('offline');
        else setSyncStatus('error');
      }
    });
  }, []);

  useEffect(() => {
    document.body.className = theme === 'standard' ? '' : `theme-${theme}`;
  }, [theme]);

  useEffect(() => {
    let intervalId;
    if (scrollStatus === 'preroll' && selectedSong) {
      const msPerBeat = 60000 / selectedSong.bpm;
      intervalId = setInterval(() => {
        setPrerollCount(c => {
          if (c <= 1) {
            setScrollStatus('scrolling');
            return 0;
          }
          return c - 1;
        });
      }, msPerBeat);
    } else if (scrollStatus === 'scrolling' && selectedSong) {
      const baseSpeed = Math.max(10, 1000 / (selectedSong.bpm / 2)); 
      const actualSpeed = baseSpeed / scrollMultiplier;
      intervalId = setInterval(() => {
        window.scrollBy({ top: 1, behavior: 'auto' });
      }, actualSpeed);
    }
    return () => clearInterval(intervalId);
  }, [scrollStatus, selectedSong, scrollMultiplier]);

  const toggleVoiceSearch = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Tu navegador no soporta búsqueda por voz.');
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    
    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.toLowerCase().replace(/[.,!¿?]/g, '').trim();
      setSearchQuery(transcript);

      // Section Jumping
      if (selectedSong) {
        let targetId = null;
        let toastMsg = '';
        if (transcript.includes('ir al coro') || transcript.includes('coro')) {
          targetId = 'section-coro';
          toastMsg = 'Saltando al Coro...';
        } else if (transcript.includes('ir a la estrofa') || transcript.includes('estrofa') || transcript.includes('verso')) {
          targetId = 'section-estrofa';
          toastMsg = 'Saltando a la Estrofa...';
        } else if (transcript.includes('ir al puente') || transcript.includes('puente')) {
          targetId = 'section-puente';
          toastMsg = 'Saltando al Puente...';
        }

        if (targetId) {
          const el = document.getElementById(targetId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setAiToast(toastMsg);
            setTimeout(() => setAiToast(''), 1500);
            return;
          }
        }
      }
      
      let cleanQuery = transcript;
      ['tocar ', 'pon ', 'busca ', 'quiero ', 'canción '].forEach(word => {
        if (cleanQuery.startsWith(word)) {
          cleanQuery = cleanQuery.replace(word, '');
        }
      });

      const numberMap = { 'uno': '1', 'dos': '2', 'tres': '3', 'cuatro': '4', 'cinco': '5', 'seis': '6', 'siete': '7', 'ocho': '8', 'nueve': '9', 'diez': '10', 'once': '11', 'doce': '12' };
      let possibleId = cleanQuery.replace(/\s+/g, '');
      Object.keys(numberMap).forEach(key => {
        possibleId = possibleId.replace(key, numberMap[key]);
      });

      const found = songs.find(s => {
        const idLower = s.id ? s.id.toLowerCase() : '';
        const titleLower = s.title.toLowerCase();
        const idMatch = idLower === possibleId || idLower === cleanQuery.replace(' ', '');
        const titleMatch = titleLower === cleanQuery || titleLower.includes(cleanQuery);
        return idMatch || titleMatch;
      });

      if (found) {
        setAiToast(`Cargando: ${found.title}...`);
        setTimeout(() => {
          setSelectedSong(found);
          setTransposeSteps(0);
          setScrollStatus('idle');
          setSearchQuery('');
          setAiToast('');
          window.scrollTo(0,0);
        }, 1500);
      }
    };
    
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleDragStart = (e, idx) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e, idx) => {
    e.preventDefault();
  };
  const handleDrop = (e, idx) => {
    e.preventDefault();
    if (draggedIdx === null) return;
    const newSetlist = [...setlist];
    const item = newSetlist.splice(draggedIdx, 1)[0];
    newSetlist.splice(idx, 0, item);
    setSetlist(newSetlist);
    setDraggedIdx(null);
  };

  const removeFromSetlist = (idx) => {
    setSetlist(setlist.filter((_, i) => i !== idx));
  };

  const renderChordPro = (text) => {
    if (!text) return null;
    const lines = text.split('\n');

    const getTransposition = (chord) => {
      let instTrans = 0;
      if (instrument === 'sax-alto') instTrans = -3;
      if (instrument === 'sax-tenor') instTrans = 2;
      return transposeChord(chord, transposeSteps + instTrans);
    };

    return lines.map((line, idx) => {
      const rawLine = line.toUpperCase();
      let sectionId = null;
      if (rawLine.includes('[CORO]') || rawLine.includes('CORO:') || rawLine === 'CORO') sectionId = 'section-coro';
      else if (rawLine.includes('[ESTROFA]') || rawLine.includes('ESTROFA:') || rawLine === 'ESTROFA' || rawLine.includes('VERSO')) sectionId = 'section-estrofa';
      else if (rawLine.includes('[PUENTE]') || rawLine.includes('PUENTE:') || rawLine === 'PUENTE') sectionId = 'section-puente';

      if (!line.includes('[')) return <div key={idx} id={sectionId || undefined} className={`min-h-12 mb-6 font-mono leading-loose ${fullScreen ? 'text-[7vw] md:text-3xl' : 'text-[1.2rem] md:text-[1.8rem]'}`}>{line}</div>;
      
      const regex = /\[(.*?)\]([^\[]*)/g;
      const parts = [];
      const firstChordIndex = line.indexOf('[');
      if (firstChordIndex > 0) {
        parts.push({ chord: '', lyric: line.substring(0, firstChordIndex) });
      }
      let match;
      while ((match = regex.exec(line)) !== null) {
        parts.push({ chord: match[1], lyric: match[2] });
      }

      return (
        <div key={idx} id={sectionId || undefined} className="flex flex-wrap items-end mb-10 mt-4">
          {parts.map((p, i) => (
            <div key={i} className="flex flex-col items-start break-inside-avoid" style={{ marginRight: p.lyric.endsWith(' ') ? '0.5em' : '0' }}>
              <span 
                className={`font-mono font-bold h-8 mb-3 ${fullScreen ? 'text-[5vw] md:text-2xl' : 'text-[1.1rem] md:text-[1.5rem]'}`}
                style={{ color: theme === 'stage' ? '#00FFFF' : '#2563EB' }}
              >
                {p.chord ? getTransposition(p.chord) : ''}
              </span>
              <span className={`font-mono whitespace-pre-wrap break-words ${fullScreen ? 'text-[7vw] md:text-3xl' : 'text-[1.2rem] md:text-[1.8rem]'}`}>{p.lyric.replace(/ /g, '\u00A0')}</span>
            </div>
          ))}
        </div>
      );
    });
  };

  const getLevenshteinDistance = (a, b) => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let prevRow = Array.from({length: a.length + 1}, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
      const currRow = [j];
      for (let i = 1; i <= a.length; i++) {
        currRow[i] = Math.min(
          currRow[i - 1] + 1,
          prevRow[i] + 1,
          prevRow[i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prevRow = currRow;
    }
    return prevRow[a.length];
  };

  const safeSearch = searchQuery.trim();
  let displaySongs = [];

  if (!safeSearch) {
    displaySongs = songs.slice(0, 20);
  } else {
    const qLower = safeSearch.toLowerCase();
    const qNoSpace = qLower.replace(/\s+/g, '');

    const processed = songs.map(song => {
      let score = 0;
      let snippet = null;

      // 1. ID Match
      if (song.id) {
        const idLower = song.id.toLowerCase();
        if (idLower === qNoSpace) score += 100;
        else if (idLower.includes(qNoSpace)) score += 80;
      }

      // 2. Title Match
      const titleLower = song.title.toLowerCase();
      if (titleLower.includes(qLower)) score += 50;
      else {
        const titleWords = titleLower.split(/\s+/);
        const queryWords = qLower.split(/\s+/);
        let titleFuzzyMatch = false;
        queryWords.forEach(qw => {
          if (qw.length > 3) {
            titleWords.forEach(tw => {
              if (Math.abs(tw.length - qw.length) <= 2 && getLevenshteinDistance(tw, qw) <= 1) {
                titleFuzzyMatch = true;
              }
            });
          }
        });
        if (titleFuzzyMatch) score += 30;
      }

      // 3. Content Match
      const cleanContent = song.content ? song.content.replace(/\[.*?\]/g, '') : '';
      if (score < 50) {
        const lines = cleanContent.split('\n').filter(l => l.trim().length > 0);
        let matchedLine = -1;
        
        matchedLine = lines.findIndex(l => l.toLowerCase().includes(qLower));
        
        if (matchedLine === -1 && qLower.length > 3) {
          const queryWords = qLower.split(/\s+/);
          for (let i = 0; i < lines.length; i++) {
             const lineWords = lines[i].toLowerCase().split(/\s+/);
             let foundTypo = false;
             for (let qw of queryWords) {
                if (qw.length > 3) {
                   for (let lw of lineWords) {
                      if (Math.abs(lw.length - qw.length) <= 2 && getLevenshteinDistance(lw, qw) <= 1) {
                         foundTypo = true;
                         break;
                      }
                   }
                }
                if (foundTypo) break;
             }
             if (foundTypo) {
               matchedLine = i;
               break;
             }
          }
        }

        if (matchedLine !== -1) {
          score += 10;
          let excerpt = lines[matchedLine].trim();
          snippet = `"...${excerpt}..."`;
        }
      }

      return { ...song, score, snippet };
    });

    displaySongs = processed
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }

  const currentSetlistIdx = selectedSong ? setlist.findIndex(s => s.id === selectedSong.id) : -1;
  const hasNextSetlist = currentSetlistIdx !== -1 && currentSetlistIdx < setlist.length - 1;
  const hasPrevSetlist = currentSetlistIdx > 0;

  return (
    <div className={`min-h-screen flex flex-col items-center transition-all duration-300 pb-40 ${fullScreen ? 'p-2' : 'py-6 px-4'}`}>
      <AnimatePresence>
        {aiToast && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }} animate={{ opacity: 1, y: 20 }} exit={{ opacity: 0, y: -50 }}
            className="fixed top-0 left-0 right-0 z-[100] flex justify-center pointer-events-none mt-4"
          >
            <div className="bg-blue-600 text-white dark:bg-amber-500 dark:text-black font-bold px-6 py-3 rounded-full shadow-2xl flex items-center gap-3">
              <Mic className="animate-pulse" size={20} />
              {aiToast}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!fullScreen && (
        <div className="w-full max-w-4xl flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Coro Pro-Web</h1>
            {syncStatus === 'synced' && <div className="flex items-center gap-1 text-xs font-bold text-green-500 bg-green-500/10 px-2 py-1 rounded-full" title="Sincronizado con la nube"><CloudCheck size={14} /> Sync</div>}
            {syncStatus === 'offline' && <div className="flex items-center gap-1 text-xs font-bold text-gray-400 bg-gray-500/10 px-2 py-1 rounded-full" title="Modo Offline"><CloudOff size={14} /> Local</div>}
          </div>
          <div className="hidden md:flex gap-2 bg-gray-100/10 p-1 rounded-full backdrop-blur-md shadow-sm border border-gray-200/20">
            <button onClick={() => setTheme('sun')} className={`min-w-[44px] min-h-[44px] flex justify-center items-center rounded-full transition-all ${theme === 'sun' ? 'bg-white shadow-md text-black' : 'text-gray-500'}`}><Sun size={18} /></button>
            <button onClick={() => setTheme('stage')} className={`min-w-[44px] min-h-[44px] flex justify-center items-center rounded-full transition-all ${theme === 'stage' ? 'bg-black shadow-md text-amber-500 border border-amber-500/30' : 'text-gray-500'}`}><Moon size={18} /></button>
            <button onClick={() => setTheme('standard')} className={`min-w-[44px] min-h-[44px] flex justify-center items-center rounded-full transition-all ${theme === 'standard' ? 'bg-blue-500 shadow-md text-white' : 'text-gray-500'}`}><Monitor size={18} /></button>
          </div>
        </div>
      )}

         <AnimatePresence mode="wait">
        {!selectedSong ? (
          <motion.div 
            key="dashboard"
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="w-full max-w-4xl p-0 md:p-8 md:rounded-3xl md:shadow-2xl md:backdrop-blur-xl md:border relative"
            style={{ backgroundColor: window.innerWidth >= 768 ? (theme === 'stage' ? '#111' : theme === 'sun' ? '#fff' : 'rgba(255,255,255,0.9)') : 'transparent', borderColor: theme === 'stage' ? '#333' : '#eee' }}
          >
            <div className="relative w-full max-w-[600px] mx-auto mb-8 px-4 md:px-0">
              <div className="absolute inset-y-0 left-8 md:left-4 flex items-center pointer-events-none"><Search className="text-gray-400" size={20} /></div>
              <input type="text" className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 bg-transparent transition-all outline-none text-lg font-medium" style={{ borderColor: theme === 'stage' ? '#333' : '#e5e7eb' }} placeholder="Busca por ID o título..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 max-w-[600px] mx-auto w-[calc(100%-2rem)]">
              <InstrumentCard active={instrument === 'guitar'} onClick={() => setInstrument('guitar')} icon={<Guitar />} title="Guitarra/Piano" theme={theme} />
              <InstrumentCard active={instrument === 'sax-alto'} onClick={() => setInstrument('sax-alto')} icon={<Music />} title="Saxo Alto (Eb)" theme={theme} />
              <InstrumentCard active={instrument === 'sax-tenor'} onClick={() => setInstrument('sax-tenor')} icon={<Music />} title="Saxo Tenor (Bb)" theme={theme} />
            </div>

            <div className="w-[calc(100%-2rem)] max-w-[600px] mx-auto space-y-3 pb-24">
              {displaySongs.map(song => {
                const inSetlist = setlist.some(s => s.id === song.id);
                return (
                  <div key={song.id} onClick={() => { setSelectedSong(song); setTransposeSteps(0); setScrollStatus('idle'); setScrollMultiplier(1.0); }} className="flex items-center justify-between p-4 rounded-2xl border cursor-pointer hover:scale-[1.01] transition-transform group" style={{ borderColor: theme === 'stage' ? '#222' : '#f3f4f6', backgroundColor: theme === 'stage' ? '#0a0a0a' : '#ffffff' }}>
                    <div className="flex items-center gap-4">
                      <span className="font-mono font-bold text-gray-400 text-sm">{song.id}</span>
                      <div>
                        <h3 className="font-bold text-lg">{song.title}</h3>
                        <div className="flex gap-2 mt-1">
                          <span className="text-xs bg-gray-500/10 px-2 py-0.5 rounded-md opacity-70">{song.category}</span>
                        </div>
                        {song.snippet && (
                          <p className="text-sm text-blue-600 dark:text-amber-400 font-mono mt-2 opacity-90 truncate max-w-xs md:max-w-md italic">
                            {song.snippet}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="font-mono text-sm opacity-50 flex items-center gap-1 hidden sm:flex">
                        <Drum size={14} /> {song.bpm} BPM
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!inSetlist) setSetlist([...setlist, song]);
                        }}
                        className={`min-w-[44px] min-h-[44px] flex justify-center items-center p-2 rounded-xl border transition-all ${inSetlist ? 'bg-green-500/20 text-green-500 border-green-500/30' : 'bg-gray-100 dark:bg-[#222] text-gray-400 border-transparent hover:border-gray-300 dark:hover:border-gray-500'}`}
                        title={inSetlist ? "En el Setlist" : "Añadir al Setlist"}
                      >
                        {inSetlist ? <ListOrdered size={20} /> : <ListPlus size={20} />}
                      </button>
                    </div>
                  </div>
                );
              })}
              {displaySongs.length === 0 && <p className="text-center opacity-50 py-10">No se encontraron canciones.</p>}
              {searchQuery.trim().length > 0 && displaySongs.length >= 20 && <p className="text-center opacity-50 text-sm mt-4 font-mono">Mostrando 20 resultados principales. Escribe más para filtrar.</p>}
            </div>

            {/* Floating Action Buttons */}
            <div className="fixed bottom-[20px] left-0 right-0 pointer-events-none flex justify-between px-[20px] z-50">
              {/* Setlist FAB (Left) */}
              <button 
                onClick={() => setShowSetlist(true)}
                className="pointer-events-auto bg-amber-500 text-black min-w-[56px] min-h-[56px] rounded-full shadow-2xl hover:scale-110 transition-transform flex justify-center items-center gap-2 px-4"
              >
                <ListOrdered size={24} />
                {setlist.length > 0 && <span className="font-bold bg-white text-black px-2 rounded-full text-sm">{setlist.length}</span>}
              </button>

              {/* Voice AI FAB (Right) */}
              <button 
                onClick={toggleVoiceSearch}
                className={`pointer-events-auto min-w-[64px] min-h-[64px] rounded-full shadow-2xl hover:scale-110 transition-all flex justify-center items-center ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-600 dark:bg-amber-500 text-white dark:text-black'}`}
              >
                <Mic size={28} />
              </button>
            </div>

          </motion.div>
        ) : (
          <motion.div 
            key="detail"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            onClick={() => { if (scrollStatus === 'scrolling') setScrollStatus('idle'); }}
            className={`w-full max-w-4xl rounded-3xl shadow-2xl backdrop-blur-xl border relative ${fullScreen ? 'p-2 md:p-6 min-h-screen border-none shadow-none' : 'p-6 md:p-8'}`}
            style={{ backgroundColor: theme === 'stage' ? '#111' : theme === 'sun' ? '#fff' : 'rgba(255,255,255,0.9)', borderColor: theme === 'stage' ? '#333' : '#eee' }}
          >
            {!fullScreen && (
              <div className="flex justify-between items-center mb-4">
                <button onClick={() => { setSelectedSong(null); setScrollStatus('idle'); }} className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
                  <ArrowLeft size={20} /> Volver al Inicio
                </button>
                {currentSetlistIdx !== -1 && (
                  <div className="flex gap-2 font-mono text-sm">
                    {hasPrevSetlist && (
                      <button onClick={(e) => { e.stopPropagation(); setSelectedSong(setlist[currentSetlistIdx - 1]); setTransposeSteps(0); setScrollStatus('idle'); window.scrollTo(0,0); }} className="flex items-center gap-1 bg-gray-500/10 px-3 py-1 rounded-lg hover:bg-gray-500/20">
                        <ChevronLeft size={16} /> Anterior
                      </button>
                    )}
                    {hasNextSetlist && (
                      <button onClick={(e) => { e.stopPropagation(); setSelectedSong(setlist[currentSetlistIdx + 1]); setTransposeSteps(0); setScrollStatus('idle'); window.scrollTo(0,0); }} className="flex items-center gap-1 bg-blue-500/10 text-blue-500 dark:bg-amber-500/10 dark:text-amber-500 px-3 py-1 rounded-lg hover:bg-blue-500/20 dark:hover:bg-amber-500/20">
                        Siguiente <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            
            <div 
              onClick={(e) => e.stopPropagation()} 
              className={`flex flex-col gap-4 sticky z-50 rounded-2xl shadow-2xl backdrop-blur-3xl ${fullScreen ? 'bottom-4 md:top-2 md:bottom-auto p-4 -mx-2 opacity-30 hover:opacity-100 transition-opacity' : 'bottom-4 md:top-4 md:bottom-auto p-4 md:p-6 -mx-4 md:mx-0 mb-8 md:mb-12'}`} 
              style={{ backgroundColor: theme === 'stage' ? 'rgba(0,0,0,0.95)' : 'rgba(255,255,255,0.95)', borderColor: theme === 'stage' ? '#444' : '#eee', borderWidth: '1px' }}
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className={`font-bold flex items-center gap-3 ${fullScreen ? 'text-xl' : 'text-3xl'}`}>
                    <span className="text-amber-500 font-mono text-xl">{selectedSong.id}</span>
                    {selectedSong.title}
                    {!fullScreen && (
                      <select 
                        value={instrument} 
                        onChange={(e) => setInstrument(e.target.value)}
                        className="text-base px-3 py-2 min-h-[44px] bg-blue-500/10 text-blue-500 dark:bg-amber-500/10 dark:text-amber-500 border border-blue-500/20 dark:border-amber-500/20 rounded-xl outline-none cursor-pointer"
                      >
                        <option value="guitar">Piano/Guitarra</option>
                        <option value="sax-alto">Saxo Alto</option>
                        <option value="sax-tenor">Saxo Tenor</option>
                      </select>
                    )}
                  </h2>
                  {!fullScreen && (
                    <div className="text-sm opacity-60 flex items-center gap-4 mt-2 font-mono">
                      <span>Tono: {selectedSong.tone}</span>
                      <span className="flex items-center gap-2">
                        <VisualMetronome bpm={selectedSong.bpm} isPlaying={scrollStatus !== 'idle'} />
                        {selectedSong.bpm} BPM
                      </span>
                    </div>
                  )}
                </div>
                
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setFullScreen(!fullScreen)} className="min-w-[44px] min-h-[44px] flex justify-center items-center rounded-xl bg-gray-500/10 hover:bg-gray-500/20 transition-all text-gray-500" title="Pantalla Completa">
                    {fullScreen ? <Minimize size={20} /> : <Maximize size={20} />}
                  </button>

                  <div className="flex items-center gap-1 bg-gray-500/10 p-1 rounded-xl">
                    <button onClick={() => setScrollMultiplier(m => Math.max(0.5, m - 0.1))} className="min-w-[44px] min-h-[44px] flex justify-center items-center rounded-lg hover:bg-gray-500/20"><Minus size={14}/></button>
                    <span className="font-mono text-xs font-bold w-6 text-center" title="Multiplicador de Velocidad">{scrollMultiplier.toFixed(1)}x</span>
                    <button onClick={() => setScrollMultiplier(m => Math.min(3.0, m + 0.1))} className="min-w-[44px] min-h-[44px] flex justify-center items-center rounded-lg hover:bg-gray-500/20"><Plus size={14}/></button>
                  </div>

                  <button 
                    onClick={() => {
                      if (scrollStatus === 'idle') {
                        setScrollStatus('preroll');
                        setPrerollCount(4);
                      } else {
                        setScrollStatus('idle');
                      }
                    }} 
                    className={`flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl font-bold transition-all ${scrollStatus === 'scrolling' ? 'bg-red-500 text-white animate-pulse shadow-md shadow-red-500/20' : scrollStatus === 'preroll' ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20' : 'bg-gray-200/20 text-gray-500 hover:bg-gray-200/40'}`}
                  >
                    {scrollStatus === 'scrolling' ? <Pause size={18} /> : scrollStatus === 'preroll' ? <Drum size={18} className="animate-bounce" /> : <ChevronDown size={18} />} 
                    {!fullScreen && (scrollStatus === 'scrolling' ? 'Pausar' : scrollStatus === 'preroll' ? `Inicia en ${prerollCount}...` : 'Auto-Scroll')}
                  </button>
                  
                  {!fullScreen && (
                    <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-1 rounded-xl border border-black/10 dark:border-white/10">
                      <button onClick={() => setTransposeSteps(s => s - 1)} className="min-w-[44px] min-h-[44px] flex justify-center items-center rounded-lg bg-black/10 dark:bg-white/10 hover:bg-black/20"><Minus size={16} /></button>
                      <span className="font-mono font-bold w-12 text-center" title="Transpositor Base">{transposeSteps > 0 ? `+${transposeSteps}` : transposeSteps}</span>
                      <button onClick={() => setTransposeSteps(s => s + 1)} className="min-w-[44px] min-h-[44px] flex justify-center items-center rounded-lg bg-black/10 dark:bg-white/10 hover:bg-black/20"><Plus size={16} /></button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="leading-relaxed pt-6 px-2 md:px-6">
              {renderChordPro(selectedSong.content)}
            </div>

            {/* Bottom Navigation for Setlist */}
            {currentSetlistIdx !== -1 && (
              <div className="mt-12 flex justify-between items-center border-t border-gray-500/20 pt-6">
                {hasPrevSetlist ? (
                  <button onClick={() => { setSelectedSong(setlist[currentSetlistIdx - 1]); setTransposeSteps(0); window.scrollTo(0,0); }} className="flex items-center gap-2 text-lg opacity-70 hover:opacity-100 transition-all">
                    <ChevronLeft /> Anterior
                  </button>
                ) : <div />}
                {hasNextSetlist && (
                  <button onClick={() => { setSelectedSong(setlist[currentSetlistIdx + 1]); setTransposeSteps(0); window.scrollTo(0,0); }} className="flex items-center gap-2 text-lg font-bold text-blue-500 dark:text-amber-500 hover:scale-105 transition-all">
                    Siguiente <ChevronRight />
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Setlist Drawer */}
      <AnimatePresence>
        {showSetlist && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }}
            className="fixed inset-x-0 bottom-0 z-[100] flex justify-center p-4 md:p-8 pointer-events-none"
          >
            <div className="w-full max-w-2xl bg-white dark:bg-[#111] border dark:border-[#333] shadow-2xl rounded-3xl p-6 pointer-events-auto" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold flex items-center gap-2"><ListOrdered /> Setlist Domingo</h3>
                <button onClick={() => setShowSetlist(false)} className="p-2 bg-gray-100 dark:bg-[#222] rounded-full hover:scale-110 transition-transform"><X size={20} /></button>
              </div>
              
              <div className="space-y-3">
                {setlist.map((s, idx) => (
                  <div 
                    key={s.id + idx}
                    draggable
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={(e) => handleDrop(e, idx)}
                    className="flex items-center justify-between p-3 rounded-xl border bg-gray-50 dark:bg-[#0a0a0a] dark:border-[#222] cursor-move hover:shadow-md transition-shadow"
                    style={{ opacity: draggedIdx === idx ? 0.5 : 1 }}
                  >
                    <div className="flex items-center gap-3">
                      <GripVertical className="text-gray-400" size={20} />
                      <span className="font-mono text-xs opacity-50">{idx + 1}.</span>
                      <span className="font-bold">{s.title}</span>
                    </div>
                    <button onClick={() => removeFromSetlist(idx)} className="text-red-500 p-2 opacity-50 hover:opacity-100 hover:bg-red-500/10 rounded-lg transition-all"><X size={16} /></button>
                  </div>
                ))}
                {setlist.length === 0 && <p className="text-center opacity-50 py-6">El setlist está vacío. Añade canciones desde el inicio.</p>}
              </div>

              {setlist.length > 0 && (
                <button 
                  onClick={() => { setSelectedSong(setlist[0]); setShowSetlist(false); setTransposeSteps(0); }}
                  className="w-full mt-6 bg-blue-600 dark:bg-amber-500 text-white dark:text-black font-bold py-4 rounded-xl shadow-lg hover:scale-[1.02] transition-transform flex justify-center items-center gap-2"
                >
                  <Play fill="currentColor" size={20} /> Iniciar Setlist
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Listener FAB */}
      {!fullScreen && !showSetlist && (
        <button 
          onClick={toggleVoiceSearch}
          className={`fixed bottom-8 right-8 p-5 md:p-6 rounded-full shadow-2xl flex items-center justify-center transition-all z-50 ${isListening ? 'bg-red-500 text-white animate-bounce scale-110 shadow-red-500/50' : 'bg-blue-600 text-white hover:bg-blue-500 hover:scale-105 shadow-blue-500/30 dark:bg-amber-500 dark:text-black dark:shadow-amber-500/20'}`}
          style={{ width: '70px', height: '70px' }}
          title="Asistente IA (Escuchar)"
        >
          <Mic size={32} className={isListening ? "animate-pulse" : ""} />
        </button>
      )}
    </div>
  );
}

function VisualMetronome({ bpm, isPlaying }) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!isPlaying || !bpm) {
      setFlash(false);
      return;
    }
    const msPerBeat = 60000 / bpm;
    const intervalId = setInterval(() => {
      setFlash(true);
      setTimeout(() => setFlash(false), 100);
    }, msPerBeat);

    return () => clearInterval(intervalId);
  }, [bpm, isPlaying]);

  return (
    <div 
      className={`w-3 h-3 rounded-full transition-all duration-75 ${flash ? 'bg-green-500 scale-125 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-gray-400/30'}`} 
    />
  );
}

function InstrumentCard({ active, onClick, icon, title, theme }) {
  let activeBg = 'bg-blue-500 border-blue-500 text-white';
  
  if (theme === 'stage') {
    activeBg = 'bg-amber-500/20 border-amber-500 text-amber-500';
  } else if (theme === 'sun') {
    activeBg = 'bg-black border-black text-white';
  }

  const inactiveBg = theme === 'stage' ? 'bg-[#111] border-[#333] text-gray-500' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300';

  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-2xl border-2 flex items-center gap-3 transition-all ${active ? activeBg : inactiveBg}`}
    >
      <div className={`${active ? 'opacity-100' : 'opacity-50'}`}>
        {icon}
      </div>
      <h3 className="font-bold">{title}</h3>
    </button>
  );
}
