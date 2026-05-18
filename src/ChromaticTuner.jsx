import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const GUITAR_STRINGS = [
  { note: 'E', octave: 4, freq: 329.63, label: '1ª' },
  { note: 'B', octave: 3, freq: 246.94, label: '2ª' },
  { note: 'G', octave: 3, freq: 196.00, label: '3ª' },
  { note: 'D', octave: 3, freq: 146.83, label: '4ª' },
  { note: 'A', octave: 2, freq: 110.00, label: '5ª' },
  { note: 'E', octave: 2, freq: 82.41,  label: '6ª' },
];

const VIOLIN_STRINGS = [
  { note: 'E', octave: 5, freq: 659.26, label: '1ª' },
  { note: 'A', octave: 4, freq: 440.00, label: '2ª' },
  { note: 'D', octave: 4, freq: 293.66, label: '3ª' },
  { note: 'G', octave: 3, freq: 196.00, label: '4ª' },
];

function freqToNoteData(freq) {
  if (!freq || freq < 20) return null;
  const semitones = 12 * Math.log2(freq / 440);
  const rounded = Math.round(semitones);
  const cents = (semitones - rounded) * 100;
  const noteIndex = ((rounded % 12) + 12) % 12;
  const octave = 4 + Math.floor((rounded + 9) / 12);
  return { note: NOTE_NAMES[noteIndex], octave, cents, freq };
}

function autoCorrelate(buf, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.008) return -1;

  const SIZE = buf.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let bestOffset = -1;
  let bestCorr = 0;
  let foundGoodCorr = false;
  const correlations = new Array(MAX_SAMPLES);

  for (let offset = 0; offset < MAX_SAMPLES; offset++) {
    let corr = 0;
    for (let i = 0; i < MAX_SAMPLES; i++) {
      corr += Math.abs(buf[i]) * Math.abs(buf[i + offset]);
    }
    correlations[offset] = corr;
    if (corr > bestCorr) { bestCorr = corr; bestOffset = offset; }
  }

  // Refine: find first dip then first peak after dip
  let lastCorr = 1;
  for (let offset = 1; offset < MAX_SAMPLES; offset++) {
    const normCorr = correlations[offset] / correlations[0];
    if (!foundGoodCorr && normCorr > 0.9) {
      foundGoodCorr = true;
      bestCorr = normCorr;
      bestOffset = offset;
    } else if (foundGoodCorr && normCorr > bestCorr) {
      bestCorr = normCorr;
      bestOffset = offset;
    } else if (foundGoodCorr && normCorr < bestCorr - 0.01) {
      break;
    }
    lastCorr = normCorr;
  }

  if (!foundGoodCorr || bestOffset < 1) return -1;

  // Parabolic interpolation
  const prev = correlations[bestOffset - 1];
  const curr = correlations[bestOffset];
  const next = bestOffset + 1 < MAX_SAMPLES ? correlations[bestOffset + 1] : curr;
  const shift = (next - prev) / (2 * (2 * curr - next - prev));
  return sampleRate / (bestOffset + (isFinite(shift) ? shift : 0));
}

// SVG Gauge Component
function TunerGauge({ cents, isActive }) {
  const clampedCents = Math.max(-50, Math.min(50, cents || 0));
  const angle = (clampedCents / 50) * 80; // -80 to +80 degrees
  const absCents = Math.abs(clampedCents);
  
  let color;
  if (!isActive) color = '#555';
  else if (absCents <= 3) color = '#00FF88';
  else if (absCents <= 10) color = '#88FF00';
  else if (absCents <= 25) color = '#FFAA00';
  else color = '#FF3344';

  const glowIntensity = isActive && absCents <= 3 ? '0 0 30px rgba(0,255,136,0.6)' : 'none';

  return (
    <svg viewBox="0 0 300 180" style={{ width: '100%', maxWidth: '320px', filter: `drop-shadow(${glowIntensity})` }}>
      {/* Background arc */}
      <path d="M 30 160 A 120 120 0 0 1 270 160" fill="none" stroke="#222" strokeWidth="8" strokeLinecap="round" />
      
      {/* Tick marks */}
      {[-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50].map(tick => {
        const a = ((tick / 50) * 80 - 90) * (Math.PI / 180);
        const cx = 150, cy = 160, r1 = 115, r2 = tick === 0 ? 98 : 105;
        return (
          <line key={tick}
            x1={cx + r1 * Math.cos(a)} y1={cy + r1 * Math.sin(a)}
            x2={cx + r2 * Math.cos(a)} y2={cy + r2 * Math.sin(a)}
            stroke={tick === 0 ? '#00FF88' : '#444'} strokeWidth={tick === 0 ? 3 : 1.5}
          />
        );
      })}

      {/* Labels */}
      <text x="40" y="170" fill="#666" fontSize="11" fontFamily="monospace">♭</text>
      <text x="252" y="170" fill="#666" fontSize="11" fontFamily="monospace">♯</text>

      {/* Needle */}
      <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '150px 160px', transition: 'transform 0.12s ease-out' }}>
        <line x1="150" y1="160" x2="150" y2="50" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <circle cx="150" cy="160" r="8" fill={color} />
        <circle cx="150" cy="160" r="4" fill="#000" />
      </g>

      {/* Center glow when in tune */}
      {isActive && absCents <= 3 && (
        <circle cx="150" cy="160" r="12" fill="none" stroke="#00FF88" strokeWidth="2" opacity="0.6">
          <animate attributeName="r" values="12;18;12" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}

// String indicator for Guitar / Violin
function StringIndicator({ strings, detectedNote, detectedOctave, theme }) {
  return (
    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', margin: '12px 0' }}>
      {strings.map((s, i) => {
        const isMatch = detectedNote === s.note && Math.abs(detectedOctave - s.octave) <= 1;
        const bg = isMatch
          ? 'linear-gradient(135deg, #00FF88, #00CC66)'
          : theme === 'stage' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
        const border = isMatch ? '2px solid #00FF88' : '2px solid transparent';
        const textColor = isMatch ? '#000' : (theme === 'stage' ? '#888' : '#666');
        const shadow = isMatch ? '0 0 16px rgba(0,255,136,0.5)' : 'none';
        return (
          <div key={i} style={{
            width: '52px', height: '52px', borderRadius: '50%',
            background: bg, border, color: textColor, boxShadow: shadow,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '16px',
            transition: 'all 0.2s ease',
          }}>
            <span>{s.note}</span>
            <span style={{ fontSize: '9px', opacity: 0.7 }}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ChromaticTuner({ isOpen, onClose, instrument, theme }) {
  const [noteData, setNoteData] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState('');
  const [isPlayingTone, setIsPlayingTone] = useState(false);
  
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const oscRef = useRef(null);
  const gainRef = useRef(null);

  const stopListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setIsListening(false);
    setNoteData(null);
  }, []);

  const startListening = useCallback(async () => {
    setMicError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      streamRef.current = stream;

      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      const buf = new Float32Array(analyser.fftSize);
      
      const detect = () => {
        analyser.getFloatTimeDomainData(buf);
        const freq = autoCorrelate(buf, ctx.sampleRate);
        if (freq > 0) {
          setNoteData(freqToNoteData(freq));
        }
        rafRef.current = requestAnimationFrame(detect);
      };
      
      setIsListening(true);
      detect();
    } catch (err) {
      console.error('Mic error:', err);
      setMicError('No se pudo acceder al micrófono. Revisa los permisos.');
    }
  }, []);

  const toggleTone440 = useCallback(() => {
    if (isPlayingTone) {
      if (oscRef.current) { oscRef.current.stop(); oscRef.current = null; }
      if (gainRef.current) { gainRef.current.disconnect(); gainRef.current = null; }
      setIsPlayingTone(false);
      return;
    }
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    oscRef.current = osc;
    gainRef.current = gain;
    setIsPlayingTone(true);
  }, [isPlayingTone]);

  // Cleanup on close
  useEffect(() => {
    if (!isOpen) {
      stopListening();
      if (oscRef.current) { oscRef.current.stop(); oscRef.current = null; }
      if (gainRef.current) { gainRef.current.disconnect(); gainRef.current = null; }
      setIsPlayingTone(false);
    }
  }, [isOpen, stopListening]);

  // Cleanup on unmount
  useEffect(() => () => {
    stopListening();
    if (oscRef.current) { try { oscRef.current.stop(); } catch(e){} }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch(e){} }
  }, [stopListening]);

  const showStrings = instrument === 'guitar' || instrument === 'violin';
  const showToneBtn = instrument === 'sax-alto' || instrument === 'sax-tenor' || instrument === 'piano';
  const strings = instrument === 'guitar' ? GUITAR_STRINGS : VIOLIN_STRINGS;

  const absCents = noteData ? Math.abs(noteData.cents) : 50;
  let noteColor = '#888';
  if (noteData && isListening) {
    if (absCents <= 3) noteColor = '#00FF88';
    else if (absCents <= 10) noteColor = '#88FF00';
    else if (absCents <= 25) noteColor = '#FFAA00';
    else noteColor = '#FF3344';
  }

  const panelBg = theme === 'stage' ? '#0a0a0a' : '#fff';
  const panelText = theme === 'stage' ? '#eee' : '#111';
  const panelBorder = theme === 'stage' ? '#222' : '#e5e7eb';

  const instrumentLabel = instrument === 'guitar' ? 'Guitarra' 
    : instrument === 'violin' ? 'Violín'
    : instrument === 'sax-alto' ? 'Saxo Alto'
    : instrument === 'sax-tenor' ? 'Saxo Tenor'
    : 'Piano';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', zIndex: 200 }}
          />
          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 60 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
              background: panelBg, color: panelText,
              borderTop: `1px solid ${panelBorder}`,
              borderRadius: '24px 24px 0 0',
              maxHeight: '88vh', overflowY: 'auto',
              boxShadow: '0 -10px 60px rgba(0,0,0,0.4)',
              padding: '24px 20px 32px',
            }}
          >
            {/* Drag handle */}
            <div style={{ width: '40px', height: '4px', borderRadius: '4px', background: '#444', margin: '0 auto 16px' }} />

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>
                  🎵 Afinador Cromático
                </h2>
                <span style={{ fontSize: '12px', opacity: 0.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {instrumentLabel}
                </span>
              </div>
              <button onClick={onClose} style={{
                width: '40px', height: '40px', borderRadius: '12px',
                background: theme === 'stage' ? '#1a1a1a' : '#f3f4f6',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: panelText,
              }}>
                <X size={20} />
              </button>
            </div>

            {/* Gauge */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <TunerGauge cents={noteData?.cents} isActive={isListening && !!noteData} />

              {/* Note display */}
              <div style={{ textAlign: 'center', marginTop: '-10px', marginBottom: '8px' }}>
                <div style={{
                  fontSize: '56px', fontWeight: 900, fontFamily: "'JetBrains Mono', monospace",
                  color: noteColor, transition: 'color 0.15s ease',
                  lineHeight: 1, minHeight: '64px',
                  textShadow: isListening && noteData && absCents <= 3 ? `0 0 20px ${noteColor}` : 'none',
                }}>
                  {isListening && noteData ? noteData.note : '—'}
                </div>
                <div style={{ fontSize: '13px', fontFamily: "'JetBrains Mono', monospace", opacity: 0.5, marginTop: '2px' }}>
                  {isListening && noteData ? `${noteData.freq.toFixed(1)} Hz  |  ${noteData.cents > 0 ? '+' : ''}${noteData.cents.toFixed(0)} cents` : 'Esperando señal...'}
                </div>
              </div>

              {/* String indicators */}
              {showStrings && isListening && (
                <StringIndicator
                  strings={strings}
                  detectedNote={noteData?.note}
                  detectedOctave={noteData?.octave}
                  theme={theme}
                />
              )}

              {/* 440Hz Tone button for Sax/Piano */}
              {showToneBtn && (
                <button onClick={toggleTone440} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  padding: '12px 24px', borderRadius: '14px', border: 'none', cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '14px',
                  background: isPlayingTone ? 'linear-gradient(135deg, #FF3344, #CC0022)' : 'linear-gradient(135deg, #00CC66, #00FF88)',
                  color: isPlayingTone ? '#fff' : '#000',
                  boxShadow: isPlayingTone ? '0 0 20px rgba(255,51,68,0.4)' : '0 0 20px rgba(0,255,136,0.3)',
                  marginBottom: '8px',
                  transition: 'all 0.2s ease',
                }}>
                  {isPlayingTone ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  {isPlayingTone ? 'Detener Tono' : 'Emitir Tono 440 Hz'}
                </button>
              )}

              {/* Mic error */}
              {micError && (
                <div style={{
                  background: 'rgba(255,51,68,0.1)', border: '1px solid rgba(255,51,68,0.3)',
                  borderRadius: '12px', padding: '10px 16px', fontSize: '13px', color: '#FF3344',
                  textAlign: 'center', marginTop: '8px', maxWidth: '300px',
                }}>
                  {micError}
                </div>
              )}

              {/* Start/Stop button */}
              <button onClick={isListening ? stopListening : startListening} style={{
                width: '100%', maxWidth: '300px', padding: '16px', borderRadius: '16px',
                border: 'none', cursor: 'pointer', marginTop: '16px',
                fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: '15px',
                background: isListening
                  ? 'linear-gradient(135deg, #FF3344, #CC0022)'
                  : 'linear-gradient(135deg, #2563EB, #1d4ed8)',
                color: '#fff',
                boxShadow: isListening
                  ? '0 4px 24px rgba(255,51,68,0.4)'
                  : '0 4px 24px rgba(37,99,235,0.4)',
                transition: 'all 0.2s ease',
                letterSpacing: '0.5px',
              }}>
                {isListening ? '⏹ Detener Afinador' : '🎤 Iniciar Afinador'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
