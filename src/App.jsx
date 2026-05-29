import React, { useState, useEffect, useRef } from 'react';
import { Search, Mic, Sun, Moon, Monitor, Music, Guitar, Drum, ArrowLeft, Plus, Minus, Play, Pause, ChevronDown, Maximize, Minimize, ListPlus, ListOrdered, X, GripVertical, ChevronLeft, ChevronRight, CloudOff, CloudCheck, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Papa from 'papaparse';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import ChromaticTuner from './ChromaticTuner';

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

export default function App({ pwaUpdateAvailable = false, onPwaUpdate = null }) {
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [newSongsAvailable, setNewSongsAvailable] = useState(false);
  const [pendingSongsData, setPendingSongsData] = useState(null);
  const [displaySongs, setDisplaySongs] = useState([]);

  // Setlist states
  const [setlist, setSetlist] = useState([]);
  const [showSetlist, setShowSetlist] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [isTunerOpen, setIsTunerOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  // Worker refs
  const workerRef = useRef(null);
  const searchRequestId = useRef(0);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // ── AI Heuristic: Convert 2-line chords (G \n Hola) to ChordPro ([G]Hola) ──
  const isChordLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return trimmed.split(/\s+/).every(word => /^[CDEFGAB][#b]?(m|M|maj|min|dim|aug|sus|add)?\d*(\/[CDEFGAB][#b]?)?$/i.test(word));
  };

  const convertTwoLineToChordPro = (text) => {
    if (!text) return text;
    const lines = text.split('\n');
    const result = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r/g, '');
      
      // If we find a line of only chords
      if (isChordLine(line)) {
        const nextLine = (i + 1 < lines.length) ? lines[i+1].replace(/\r/g, '') : null;
        
        // If the next line exists, has content, and is NOT a chord line (it's lyrics)
        if (nextLine !== null && nextLine.trim().length > 0 && !isChordLine(nextLine)) {
          let isSectionHeader = /^(CORO|ESTROFA|PUENTE|VERSO)/i.test(nextLine.trim());
          if (!isSectionHeader) {
            // Find exactly where each chord starts
            const chordRegex = /([CDEFGAB][#b]?(?:m|M|maj|min|dim|aug|sus|add)?\d*(?:\/[CDEFGAB][#b]?)?)/gi;
            let match;
            const chords = [];
            while ((match = chordRegex.exec(line)) !== null) {
              chords.push({ chord: match[1], index: match.index });
            }
            
            // Pad lyrics line if it's shorter than the position of the last chord
            let merged = nextLine;
            if (chords.length > 0) {
              const lastChord = chords[chords.length - 1];
              if (merged.length < lastChord.index) {
                merged = merged.padEnd(lastChord.index, ' ');
              }
            }
            
            // Inject chords right-to-left so indices don't shift
            for (let j = chords.length - 1; j >= 0; j--) {
              const { chord, index } = chords[j];
              merged = merged.substring(0, index) + `[${chord}]` + merged.substring(index);
            }
            
            result.push(merged);
            i++; // Skip the lyric line since we merged it
            continue;
          }
        }
      }
      
      // Default: push the line unchanged
      result.push(line);
    }
    
    return result.join('\n');
  };

  // ── CORS-safe fetch helper (cache-busted, no PapaParse XHR) ────────────
  const fetchFromSheet = async () => {
    const base =
      import.meta.env.VITE_GOOGLE_SHEETS_CSV_URL ||
      'https://docs.google.com/spreadsheets/d/1RmJvERvRZjH-TKOquyOBwyMmWsZ8PqKdxDIhc7Ov_vk/export?format=csv&gid=0';
    // Append timestamp to bypass CDN / browser cache every time
    const url = `${base}&t=${Date.now()}`;
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsed = results.data
            .filter(r => r['Título'])
            .map(row => ({
              id: row['ID'],
              title: row['Título'],
              tone: row['Tono'],
              bpm: parseInt(row['BPM']) || 100,
              category: row['Categoría'],
              content: convertTwoLineToChordPro(row['Contenido (Letra y Acordes para IA)'] || ''),
            }));
          resolve(parsed);
        },
        error: reject,
      });
    });
  };

  // ── Stale-While-Revalidate boot ─────────────────────────────────────────
  // Lightweight hash: XOR of char codes on id+first 20 chars of content
  const computeEtag = (songs) =>
    songs.reduce((acc, s) => {
      const str = (s.id || '') + (s.content || '').slice(0, 20);
      for (let i = 0; i < str.length; i++) acc ^= str.charCodeAt(i) * (i + 1);
      return acc;
    }, songs.length).toString(36);

  const revalidate = async (cachedSongs) => {
    try {
      const fresh = await fetchFromSheet();
      const freshEtag = computeEtag(fresh);
      const localEtag = localStorage.getItem('coro_songs_etag') || '';

      if (freshEtag !== localEtag && cachedSongs.length > 0) {
        // Data changed — notify instead of silently replacing
        setPendingSongsData(fresh);
        setNewSongsAvailable(true);
      } else if (cachedSongs.length === 0) {
        // First load: apply immediately
        setSongs(fresh);
        localStorage.setItem('coro_songs', JSON.stringify(fresh));
        localStorage.setItem('coro_songs_etag', freshEtag);
      }
      setSyncStatus('synced');
    } catch {
      setSyncStatus(cachedSongs.length > 0 ? 'offline' : 'error');
    }
  };

  useEffect(() => {
    // 1. STALE: show cached data instantly
    const localRaw = localStorage.getItem('coro_songs');
    let cachedSongs = [];
    if (localRaw) {
      try {
        cachedSongs = JSON.parse(localRaw);
        setSongs(cachedSongs);
        setSyncStatus('offline');
      } catch (e) {
        console.error('Local data corrupted', e);
      }
    }

    // 2. REVALIDATE on boot
    revalidate(cachedSongs);

    // 3. Periodic revalidation every 5 minutes while app is open
    const interval = setInterval(() => {
      const raw = localStorage.getItem('coro_songs');
      const current = raw ? JSON.parse(raw) : [];
      revalidate(current);
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // ── Worker initialisation ────────────────────────────────────────────────
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const worker = new Worker('/searchWorker.js');
    workerRef.current = worker;
    worker.onmessage = (e) => {
      const { results, requestId } = e.data;
      // Discard stale responses from previous searches
      if (requestId === searchRequestId.current) {
        setDisplaySongs(results);
      }
    };
    return () => worker.terminate();
  }, []);

  // ── Dispatch search to Worker on query/songs change ──────────────────────
  useEffect(() => {
    const id = ++searchRequestId.current;
    if (workerRef.current) {
      workerRef.current.postMessage({ songs, query: searchQuery, requestId: id });
    } else {
      // Sync fallback: show all songs (no artificial cap)
      if (!searchQuery.trim()) {
        setDisplaySongs(songs);
      } else {
        setDisplaySongs(songs);
      }
    }
  }, [songs, searchQuery]);

  const handleManualSync = () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncProgress(0);
    setSyncStatus('loading');
    setNewSongsAvailable(false);
    setPendingSongsData(null);

    // Animate progress bar to ~60% while fetching
    let prog = 0;
    const fakeProgress = setInterval(() => {
      prog += Math.random() * 8;
      if (prog >= 60) { clearInterval(fakeProgress); prog = 60; }
      setSyncProgress(Math.min(prog, 60));
    }, 150);

    localStorage.removeItem('coro_songs');
    localStorage.removeItem('coro_songs_etag');
    setSongs([]);

    fetchFromSheet()
      .then(fresh => {
        clearInterval(fakeProgress);
        setSyncProgress(85);
        const etag = computeEtag(fresh);
        setSongs(fresh);
        localStorage.setItem('coro_songs', JSON.stringify(fresh));
        localStorage.setItem('coro_songs_etag', etag);
        setSyncStatus('synced');
        setTimeout(() => setSyncProgress(100), 200);
        setTimeout(() => { setIsSyncing(false); setSyncProgress(0); }, 1000);
      })
      .catch(() => {
        clearInterval(fakeProgress);
        setSyncStatus('offline');
        setSyncProgress(100);
        setTimeout(() => { setIsSyncing(false); setSyncProgress(0); }, 800);
      });
  };

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
    if (navigator.vibrate) navigator.vibrate([50]);
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
      // Clean carriage returns
      line = line.replace(/\r/g, '');
      const rawLine = line.toUpperCase().trim();
      let sectionId = null;
      if (rawLine.includes('[CORO]') || rawLine.includes('CORO:') || rawLine === 'CORO') sectionId = 'section-coro';
      else if (rawLine.includes('[ESTROFA]') || rawLine.includes('ESTROFA:') || rawLine === 'ESTROFA' || rawLine.includes('VERSO')) sectionId = 'section-estrofa';
      else if (rawLine.includes('[PUENTE]') || rawLine.includes('PUENTE:') || rawLine === 'PUENTE') sectionId = 'section-puente';

      if (!line.includes('[')) {
        // Fallback for lines with pure chords (e.g., "G  C  D" or "Am7  D7")
        const isChordLine = line.trim().length > 0 && line.trim().split(/\s+/).every(word => {
          return /^[CDEFGAB][#b]?(m|M|maj|min|dim|aug|sus|add)?\d*(\/[CDEFGAB][#b]?)?$/i.test(word);
        });

        if (isChordLine) {
          const chords = line.split(/(\s+)/);
          return (
            <div key={idx} id={sectionId || undefined} className="flex flex-wrap items-end mb-2 mt-4">
              <span 
                className={`font-mono font-bold whitespace-pre-wrap ${fullScreen ? 'text-[5vw] md:text-2xl' : 'text-[1.1rem] md:text-[1.5rem]'}`}
                style={{ color: theme === 'stage' ? '#00FFFF' : '#2563EB', minHeight: '1.2em' }}
              >
                {chords.map(c => c.trim() ? getTransposition(c.trim()) : c).join('')}
              </span>
            </div>
          );
        }

        // Normal lyric line (no chords)
        return (
          <div key={idx} id={sectionId || undefined} className={`min-h-[1.5em] mb-4 mt-2 font-mono leading-normal ${fullScreen ? 'text-[7vw] md:text-3xl' : 'text-[1.2rem] md:text-[1.8rem]'}`} style={{ color: theme === 'stage' ? '#F59E0B' : '#111827' }}>
            {line}
          </div>
        );
      }
      
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
        <div key={idx} id={sectionId || undefined} className="flex flex-wrap items-end mb-6 mt-4">
          {parts.map((p, i) => (
            <div key={i} className="flex flex-col items-start" style={{ marginRight: '0' }}>
              {/* Top Row: Chord */}
              <span 
                className={`font-mono font-bold leading-tight mb-0.5 ${fullScreen ? 'text-[5vw] md:text-2xl' : 'text-[1.1rem] md:text-[1.5rem]'}`}
                style={{ color: theme === 'stage' ? '#00FFFF' : '#2563EB', minHeight: '1.2em' }}
              >
                {p.chord ? getTransposition(p.chord) : ''}
              </span>
              {/* Bottom Row: Lyric */}
              <span 
                className={`font-mono whitespace-pre-wrap leading-tight ${fullScreen ? 'text-[7vw] md:text-3xl' : 'text-[1.2rem] md:text-[1.8rem]'}`}
                style={{ color: theme === 'stage' ? '#F59E0B' : '#111827', minHeight: '1.2em' }}
              >
                {p.lyric || ' '}
              </span>
            </div>
          ))}
        </div>
      );
    });
  };

  // displaySongs is now driven by the Web Worker via state (see useEffect above)

  const currentSetlistIdx = selectedSong ? setlist.findIndex(s => s.id === selectedSong.id) : -1;
  const hasNextSetlist = currentSetlistIdx !== -1 && currentSetlistIdx < setlist.length - 1;
  const hasPrevSetlist = currentSetlistIdx > 0;

  return (
    <div className={`min-h-screen flex flex-col items-center transition-all duration-300 pb-40 ${fullScreen ? 'p-2' : 'py-6 px-4'}`}>

      {/* ── PWA Update Banner (new APP version) ── */}
      <AnimatePresence>
        {pwaUpdateAvailable && (
          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[195] pointer-events-auto w-full max-w-sm px-4"
          >
            <div
              className="w-full flex items-center justify-between gap-3 px-5 py-3.5 rounded-2xl shadow-2xl backdrop-blur-xl border"
              style={{
                background: 'rgba(15,15,15,0.92)',
                borderColor: 'rgba(250,204,21,0.4)',
                color: '#fff'
              }}
            >
              <div className="flex items-center gap-2 flex-1">
                <span className="text-amber-400 text-lg">⚡</span>
                <span className="text-sm font-semibold">Nueva versión disponible</span>
              </div>
              <button
                onClick={() => onPwaUpdate?.()}
                className="shrink-0 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-3 py-1.5 rounded-xl transition-all hover:scale-105 active:scale-95"
              >
                Actualizar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── New Songs Available Banner ── */}
      <AnimatePresence>
        {newSongsAvailable && (
          <motion.div
            initial={{ opacity: 0, y: -60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -60 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[190] pointer-events-auto w-full max-w-sm px-4"
          >
            <button
              onClick={() => {
                setSongs(pendingSongsData);
                localStorage.setItem('coro_songs', JSON.stringify(pendingSongsData));
                setPendingSongsData(null);
                setNewSongsAvailable(false);
              }}
              className="w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-2xl font-bold text-sm shadow-2xl backdrop-blur-xl border border-white/20 transition-all hover:scale-[1.02] active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)',
                color: '#fff',
                boxShadow: '0 8px 32px rgba(124,58,237,0.4)'
              }}
            >
              <span className="text-lg">🎵</span>
              <span>¡Nuevas canciones disponibles! Toca aquí para actualizar</span>
              <motion.div
                animate={{ x: [0, 4, 0] }}
                transition={{ repeat: Infinity, duration: 1.2 }}
              >
                <RefreshCw size={16} />
              </motion.div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sync Progress Bar ── */}
      <AnimatePresence>
        {isSyncing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] pointer-events-none flex flex-col"
          >
            {/* Top progress bar */}
            <div className="w-full h-1 bg-gray-200/20">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: 'linear-gradient(90deg, #3b82f6, #06b6d4, #8b5cf6)',
                  boxShadow: '0 0 12px rgba(59,130,246,0.7)'
                }}
                animate={{ width: `${syncProgress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>
            {/* Overlay card */}
            <div className="flex-1 flex items-center justify-center">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="pointer-events-auto bg-white/10 dark:bg-black/60 backdrop-blur-2xl border border-white/20 rounded-3xl p-8 shadow-2xl flex flex-col items-center gap-5 min-w-[260px]"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
                >
                  <RefreshCw size={36} className="text-blue-400 dark:text-amber-400" />
                </motion.div>
                <div className="text-center">
                  <p className="font-bold text-lg">Sincronizando...</p>
                  <p className="text-sm opacity-60 mt-1">Descargando canciones actualizadas</p>
                </div>
                {/* Mini progress bar inside card */}
                <div className="w-full h-2 bg-gray-200/20 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
                    animate={{ width: `${syncProgress}%` }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  />
                </div>
                <span className="font-mono text-sm opacity-70">{Math.round(syncProgress)}%</span>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
          <div className="flex items-center gap-2 md:gap-4">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Coro Pro-Web</h1>
            {/* Song counter */}
            {songs.length > 0 && (
              <div
                className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full"
                style={{
                  color: theme === 'stage' ? '#f59e0b' : '#2563eb',
                  background: theme === 'stage' ? 'rgba(245,158,11,0.12)' : 'rgba(37,99,235,0.08)'
                }}
                title="Total de canciones cargadas"
              >
                <Music size={11} />
                {songs.length} canciones
              </div>
            )}
            {syncStatus === 'synced' && <div className="hidden sm:flex items-center gap-1 text-xs font-bold text-green-500 bg-green-500/10 px-2 py-1 rounded-full" title="Sincronizado con la nube"><CloudCheck size={14} /> Sync</div>}
            {syncStatus === 'offline' && <div className="hidden sm:flex items-center gap-1 text-xs font-bold text-gray-400 bg-gray-500/10 px-2 py-1 rounded-full" title="Modo Offline"><CloudOff size={14} /> Local</div>}
          </div>
          <div className="hidden md:flex gap-2 bg-gray-100/10 p-1 rounded-full backdrop-blur-md shadow-sm border border-gray-200/20">
            <button onClick={() => setIsTunerOpen(true)} className={`min-w-[44px] min-h-[44px] flex justify-center items-center rounded-full transition-all text-blue-500 dark:text-amber-500 hover:bg-black/5 dark:hover:bg-white/5`} title="Afinador">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-9"/><path d="M8 13V6a4 4 0 0 1 8 0v7"/></svg>
            </button>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-700 self-center mx-1"></div>
            <button onClick={() => setTheme('sun')} className={`min-w-[44px] min-h-[44px] flex justify-center items-center rounded-full transition-all ${theme === 'sun' ? 'bg-white shadow-md text-black' : 'text-gray-500'}`}><Sun size={18} /></button>
            <button onClick={() => setTheme('stage')} className={`min-w-[44px] min-h-[44px] flex justify-center items-center rounded-full transition-all ${theme === 'stage' ? 'bg-black shadow-md text-amber-500 border border-amber-500/30' : 'text-gray-500'}`}><Moon size={18} /></button>
            <button onClick={() => setTheme('standard')} className={`min-w-[44px] min-h-[44px] flex justify-center items-center rounded-full transition-all ${theme === 'standard' ? 'bg-blue-500 shadow-md text-white' : 'text-gray-500'}`}><Monitor size={18} /></button>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-700 self-center mx-1"></div>
            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              title="Sincronizar Datos"
              className={`min-w-[44px] min-h-[44px] flex justify-center items-center gap-2 px-3 rounded-full transition-all font-semibold text-sm ${
                isSyncing
                  ? 'text-blue-400 dark:text-amber-400 opacity-60 cursor-not-allowed'
                  : 'text-blue-500 dark:text-amber-500 hover:bg-blue-500/10 dark:hover:bg-amber-500/10'
              }`}
            >
              <motion.div
                animate={isSyncing ? { rotate: 360 } : { rotate: 0 }}
                transition={isSyncing ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
              >
                <RefreshCw size={17} />
              </motion.div>
              <span className="hidden lg:inline">Sincronizar</span>
            </button>
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
            <div className="relative w-full max-w-[600px] mx-auto mb-12 px-4 md:px-0">
              <div className="absolute inset-y-0 left-8 md:left-4 flex items-center pointer-events-none"><Search className="text-gray-400" size={20} /></div>
              <input type="text" className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 bg-transparent transition-all outline-none text-lg font-medium" style={{ borderColor: theme === 'stage' ? '#333' : '#e5e7eb' }} placeholder="Busca por ID o título..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 mt-2 max-w-[600px] md:max-w-4xl mx-auto w-[calc(100%-2rem)]">
              <InstrumentCard active={instrument === 'guitar'} onClick={() => setInstrument('guitar')} icon={<Guitar />} title="Piano/Guit" theme={theme} />
              <InstrumentCard active={instrument === 'violin'} onClick={() => setInstrument('violin')} icon={<Music />} title="Violín" theme={theme} />
              <InstrumentCard active={instrument === 'sax-alto'} onClick={() => setInstrument('sax-alto')} icon={<Music />} title="Saxo (Eb)" theme={theme} />
              <InstrumentCard active={instrument === 'sax-tenor'} onClick={() => setInstrument('sax-tenor')} icon={<Music />} title="Saxo (Bb)" theme={theme} />
            </div>

            <div className="w-[calc(100%-2rem)] max-w-[600px] mx-auto space-y-3 pb-40">
              {displaySongs.map(song => {
                const setlistIndex = setlist.findIndex(s => s.id === song.id);
                const inSetlist = setlistIndex !== -1;
                return (
                  <div key={song.id} onClick={() => { setSelectedSong(song); setTransposeSteps(0); setScrollStatus('idle'); setScrollMultiplier(1.0); }} className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer hover:scale-[1.01] transition-all group ${inSetlist ? 'shadow-[0_0_15px_rgba(245,158,11,0.1)]' : ''}`} style={{ borderColor: inSetlist ? (theme === 'stage' ? 'rgba(245,158,11,0.5)' : 'rgba(59,130,246,0.5)') : (theme === 'stage' ? '#222' : '#f3f4f6'), backgroundColor: theme === 'stage' ? '#0a0a0a' : '#ffffff' }}>
                    <div className="flex items-center gap-4">
                      <span className="font-mono font-bold text-gray-400 text-sm">{song.id}</span>
                      <div>
                        <h3 className="font-bold text-lg flex items-center gap-2">
                          {song.title}
                          {inSetlist && <span className="bg-blue-500 dark:bg-amber-500 text-white dark:text-black text-[10px] px-1.5 py-0.5 rounded-full font-mono">{setlistIndex + 1}</span>}
                        </h3>
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
                          if (inSetlist) {
                            setSetlist(setlist.filter(s => s.id !== song.id));
                          } else {
                            setSetlist([...setlist, song]);
                          }
                        }}
                        className={`min-w-[44px] min-h-[44px] flex justify-center items-center p-2 rounded-xl border transition-all active:scale-90 ${inSetlist ? 'bg-red-500/10 text-red-500 border-red-500/30 hover:bg-red-500/20' : 'bg-gray-100 dark:bg-[#222] text-gray-400 border-transparent hover:border-gray-300 dark:hover:border-gray-500'}`}
                        title={inSetlist ? "Quitar del Setlist" : "Añadir al Setlist"}
                      >
                        {inSetlist ? <X size={20} /> : <ListPlus size={20} />}
                      </button>
                    </div>
                  </div>
                );
              })}
              {displaySongs.length === 0 && <p className="text-center opacity-50 py-10">No se encontraron canciones.</p>}
              {searchQuery.trim().length > 0 && displaySongs.length >= 50 && <p className="text-center opacity-50 text-sm mt-4 font-mono">Mostrando los 50 mejores resultados. Escribe más para filtrar.</p>}
            </div>

            {/* Floating Action Buttons Removed */}

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
              className={`flex flex-col sticky z-40 rounded-b-3xl md:rounded-2xl shadow-2xl backdrop-blur-3xl transition-all duration-300 ${fullScreen ? 'top-0 p-4 -mx-2 opacity-30 hover:opacity-100' : `top-0 -mx-4 md:mx-0 mb-8 md:mb-12 ${isScrolled ? 'p-3' : 'p-4 md:p-6'} gap-2 md:gap-4`}`} 
              style={{ backgroundColor: theme === 'stage' ? 'rgba(0,0,0,0.95)' : 'rgba(255,255,255,0.95)', borderColor: theme === 'stage' ? '#444' : '#eee', borderWidth: '1px' }}
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 md:gap-4">
                <div>
                  <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 transition-all mb-2 md:mb-0">
                    <h2 className={`font-bold flex items-start md:items-center gap-2 md:gap-3 flex-wrap ${fullScreen ? 'text-xl' : isScrolled ? 'text-xl' : 'text-2xl md:text-3xl'}`}>
                      <span className="text-amber-500 font-mono text-xl md:text-2xl mt-1 md:mt-0">{selectedSong.id}</span>
                      <span className="text-wrap leading-tight">{selectedSong.title}</span>
                    </h2>
                    {!fullScreen && !isScrolled && (
                      <select 
                        value={instrument} 
                        onChange={(e) => setInstrument(e.target.value)}
                        className="text-sm md:text-base px-3 py-1.5 md:py-2 min-h-[36px] md:min-h-[44px] bg-blue-500/10 text-blue-500 dark:bg-amber-500/10 dark:text-amber-500 border border-blue-500/20 dark:border-amber-500/20 rounded-xl outline-none cursor-pointer w-fit"
                      >
                        <option value="guitar">Piano/Guitarra</option>
                        <option value="violin">Violín</option>
                        <option value="sax-alto">Saxo Alto (Eb)</option>
                        <option value="sax-tenor">Saxo Tenor (Bb)</option>
                      </select>
                    )}
                  </div>
                  {!fullScreen && !isScrolled && (
                    <div className="text-sm opacity-60 flex items-center gap-4 mt-2 font-mono transition-all">
                      <span>Tono: {selectedSong.tone}</span>
                      <span className="flex items-center gap-2">
                        <VisualMetronome bpm={selectedSong.bpm} isPlaying={scrollStatus !== 'idle'} />
                        {selectedSong.bpm} BPM
                      </span>
                    </div>
                  )}
                </div>
                
                <div className="flex flex-wrap items-center gap-2">
                  {!isScrolled && (
                    <>
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
                    </>
                  )}
                  
                  {!fullScreen && (
                    <div className="flex flex-col items-center ml-auto md:ml-0">
                      <span className="text-[10px] font-mono opacity-50 mb-0.5 leading-none">Tono</span>
                      <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-1 rounded-xl border border-black/10 dark:border-white/10">
                        <button onClick={() => setTransposeSteps(s => s - 1)} className="min-w-[36px] min-h-[36px] md:min-w-[44px] md:min-h-[44px] flex justify-center items-center rounded-lg bg-black/10 dark:bg-white/10 hover:bg-black/20"><Minus size={16} /></button>
                        <span className="font-mono font-bold w-8 md:w-12 text-center" title="Transpositor Base">{transposeSteps > 0 ? `+${transposeSteps}` : transposeSteps}</span>
                        <button onClick={() => setTransposeSteps(s => s + 1)} className="min-w-[36px] min-h-[36px] md:min-w-[44px] md:min-h-[44px] flex justify-center items-center rounded-lg bg-black/10 dark:bg-white/10 hover:bg-black/20"><Plus size={16} /></button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="leading-relaxed pt-6 px-2 md:px-6 pb-[120px]">
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

      {/* Bottom Navigation Dock */}
      {!fullScreen && !showSetlist && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none w-full px-4 max-w-sm flex justify-center">
          <div 
            className="pointer-events-auto w-full flex items-center justify-between px-6 py-3 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-white/20 backdrop-blur-3xl"
            style={{ 
              backgroundColor: theme === 'stage' ? 'rgba(20,20,20,0.75)' : 'rgba(255,255,255,0.75)',
              borderColor: theme === 'stage' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
            }}
          >
            {/* Left: Setlist */}
            <button 
              onClick={() => setShowSetlist(true)}
              className="flex flex-col items-center gap-1 opacity-70 hover:opacity-100 transition-opacity relative"
            >
              <div className="relative">
                <ListOrdered size={24} />
                {setlist.length > 0 && (
                  <span className="absolute -top-2 -right-2 bg-amber-500 text-black text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
                    {setlist.length}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">Setlist</span>
            </button>

            {/* Center: Voice AI (Highlight) */}
            <button 
              onClick={toggleVoiceSearch}
              className={`relative -top-6 min-w-[64px] min-h-[64px] rounded-full shadow-lg flex justify-center items-center transition-all ${isListening ? 'bg-red-500 text-white animate-pulse shadow-red-500/40' : 'bg-blue-600 dark:bg-amber-500 text-white dark:text-black hover:scale-105'}`}
            >
              <Mic size={28} />
            </button>

            {/* Right: Tuner only */}
            <button 
              onClick={() => setIsTunerOpen(true)}
              className="flex flex-col items-center gap-1 opacity-70 hover:opacity-100 transition-opacity"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-9"/><path d="M8 13V6a4 4 0 0 1 8 0v7"/></svg>
              <span className="text-[10px] font-medium">Afinador</span>
            </button>
          </div>
        </div>
      )}

      {/* Chromatic Tuner Component */}
      <ChromaticTuner 
        isOpen={isTunerOpen} 
        onClose={() => setIsTunerOpen(false)} 
        instrument={instrument} 
        theme={theme} 
      />
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
