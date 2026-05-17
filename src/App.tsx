import React, { useEffect, useState, useRef } from 'react';
import { WebMidi, Output } from 'webmidi';
import { Settings, Play, Pause, Square, Music, Activity, Trash2, Plus } from 'lucide-react';

type MidiCue = {
  id: string;
  time: number; // in seconds
  action: 'noteon' | 'cc';
  channel: number;
  data1: string; // note name or CC number
  data2: number; // velocity or CC value
};

const formatTime = (timeInSeconds: number) => {
    const mins = Math.floor(timeInSeconds / 60);
    const secs = Math.floor(timeInSeconds % 60);
    const ms = Math.floor((timeInSeconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioSrc, setAudioSrc] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [vol, setVol] = useState<number>(100);

  const [midiEnabled, setMidiEnabled] = useState<boolean>(false);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [cues, setCues] = useState<MidiCue[]>([]);
  const cuesRef = useRef<MidiCue[]>([]);
  const [logs, setLogs] = useState<{id: string, msg: string}[]>([]);

  const requestRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);

  // Sync cues to ref for use in animation frame
  useEffect(() => {
     cuesRef.current = cues;
  }, [cues]);

  // Volume effect
  useEffect(() => {
     if (audioRef.current) {
         audioRef.current.volume = vol / 100;
     }
  }, [vol]);

  const initMidi = async () => {
    WebMidi.enable({ sysex: true })
      .then(() => {
        setMidiEnabled(true);
        setError(null);
        
        setOutputs(WebMidi.outputs);
        if (WebMidi.outputs.length > 0) {
          setSelectedOutput(WebMidi.outputs[0].id);
        }

        WebMidi.addListener('connected', () => setOutputs(WebMidi.outputs));
        WebMidi.addListener('disconnected', () => {
          setOutputs(WebMidi.outputs);
          if (WebMidi.outputs.length === 0) setSelectedOutput('');
          else if (!WebMidi.getOutputById(selectedOutput)) setSelectedOutput(WebMidi.outputs[0].id);
        });
      })
      .catch(err => {
        setError("WebMidi could not be enabled. Error: " + err);
        setMidiEnabled(false);
      });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          stopPlay();
          const url = URL.createObjectURL(file);
          setAudioSrc(url);
          setFileName(file.name);
          if (audioRef.current) {
              audioRef.current.src = url;
              audioRef.current.load();
          }
      }
  };

  const togglePlay = () => {
      if (!audioRef.current || !audioSrc) return;
      if (isPlaying) {
          audioRef.current.pause();
          setIsPlaying(false);
      } else {
          audioRef.current.play();
          setIsPlaying(true);
      }
  };

  const stopPlay = () => {
      if (!audioRef.current) return;
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
      lastTimeRef.current = 0;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
      const time = parseFloat(e.target.value);
      if (audioRef.current) {
          audioRef.current.currentTime = time;
      }
      setCurrentTime(time);
      lastTimeRef.current = time;
  };

  // Main playback loop
  const checkCues = () => {
      if (!audioRef.current) return;
      const time = audioRef.current.currentTime;
      const lastTime = lastTimeRef.current;
      setCurrentTime(time);
      
      // Fire Cues if playing forward within normal delta
      if (time > lastTime && time - lastTime < 1 && WebMidi.enabled && selectedOutput) {
           const output = WebMidi.getOutputById(selectedOutput);
           let triggeredAny = false;
           
           if (output) {
               cuesRef.current.forEach(cue => {
                    if (cue.time > lastTime && cue.time <= time) {
                         triggeredAny = true;
                         const ch = output.channels[cue.channel];
                         try {
                             if (cue.action === 'noteon') {
                                 ch.playNote(cue.data1, { rawVelocity: true, velocity: cue.data2 });
                             } else if (cue.action === 'cc') {
                                 ch.sendControlChange(Number(cue.data1), cue.data2);
                             }
                             
                             // Add to log
                             setLogs(prev => [
                                 { id: Math.random().toString(), msg: `[${formatTime(time)}] CH${cue.channel} ${cue.action} ${cue.data1} V:${cue.data2}` },
                                 ...prev
                             ].slice(0, 20));
                         } catch(e) {
                             console.error("MIDI Error", e);
                         }
                    }
               });
           }
      }
      
      lastTimeRef.current = time;
      requestRef.current = requestAnimationFrame(checkCues);
  };

  useEffect(() => {
      if (isPlaying) {
          requestRef.current = requestAnimationFrame(checkCues);
      } else {
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
      }
      return () => {
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
      }
  }, [isPlaying, selectedOutput]);

  const addCue = () => {
      const newCue: MidiCue = {
          id: Math.random().toString(36).substr(2, 9),
          time: parseFloat(currentTime.toFixed(3)),
          action: 'noteon',
          channel: 1,
          data1: 'C3',
          data2: 127
      };
      setCues(prev => [...prev, newCue].sort((a,b) => a.time - b.time));
  };
  
  const updateCue = (id: string, key: keyof MidiCue, value: any) => {
      setCues(prev => prev.map(c => c.id === id ? { ...c, [key]: value } : c).sort((a,b) => a.time - b.time));
  }

  const removeCue = (id: string) => {
      setCues(prev => prev.filter(c => c.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#E0E0E0] font-sans selection:bg-[#FF4E00]/30 flex flex-col">
      <audio 
        ref={audioRef} 
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} 
        onEnded={stopPlay} 
        className="hidden" 
      />
      
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2A2A2D] bg-[#121214] sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-[#FF4E00] rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(255,78,0,0.3)]">
            <Music className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white uppercase">SHOW CONSOLE <span className="text-[#666] font-normal ml-2 text-sm">v2.0</span></h1>
            <p className="text-[10px] text-[#FF4E00] font-mono tracking-widest uppercase">UNIVERSAL MIDI TRIGGER ENGINE</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 bg-[#1C1C1F] px-3 py-1.5 rounded border border-[#2A2A2D]">
            <div className={`w-2 h-2 rounded-full ${midiEnabled ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`}></div>
            <span className="text-[11px] font-mono">{midiEnabled ? 'MIDI SYSTEM ONLINE' : 'SYSTEM OFFLINE'}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full bg-[#0F0F11] relative isolate overflow-hidden flex">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
        
        <div className="flex w-full relative z-10">
          
          {/* Left Sidebar */}
          <aside className="w-80 bg-[#121214] border-r border-[#2A2A2D] flex flex-col pt-6 z-20">
            <div className="px-6 mb-8">
               <h2 className="text-[11px] font-bold text-[#666] uppercase tracking-widest mb-4">MIDI Output Interface</h2>
               {!midiEnabled ? (
                  <button 
                    onClick={initMidi}
                    className="w-full py-3 px-4 bg-[#FF4E00] hover:bg-[#E64600] active:bg-[#CC3E00] text-black rounded text-xs font-bold uppercase tracking-widest transition-all"
                  >
                    Connect MIDI Subsystem
                  </button>
               ) : (
                  <div className="space-y-4">
                      <div>
                        <label className="text-[10px] text-[#666] uppercase tracking-widest flex items-center mb-2">
                          Primary Hardware Output
                        </label>
                        <select 
                          value={selectedOutput}
                          onChange={(e) => setSelectedOutput(e.target.value)}
                          className="w-full bg-[#1C1C1F] border border-[#2A2A2D] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF4E00] transition-colors appearance-none font-mono text-[#E0E0E0] shadow-[inset_0_-1px_0_#2A2A2D]"
                        >
                          {outputs.length === 0 && <option value="">No targets detected</option>}
                          {outputs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </div>
                  </div>
               )}
            </div>

            <div className="px-6">
                <h2 className="text-[11px] font-bold text-[#666] uppercase tracking-widest mb-4">Audio Track</h2>
                <div className="bg-[#1C1C1F] border border-[#2A2A2D] border-dashed rounded p-4 text-center">
                   <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" id="audio-upload" />
                   <label htmlFor="audio-upload" className="cursor-pointer flex flex-col items-center">
                       <Music className="w-6 h-6 text-[#444] mb-2" />
                       <span className="text-xs font-bold text-[#E0E0E0] tracking-wider mb-1 uppercase">Load Track File</span>
                       <span className="text-[10px] text-[#666] font-mono">.WAV .MP3 .OGG .FLAC</span>
                   </label>
                </div>
                {fileName && (
                   <div className="mt-4 p-3 bg-[#1C1C1F] border border-[#FF4E00]/50 rounded border-l-2 border-l-[#FF4E00]">
                       <div className="text-[10px] text-[#FF4E00] mb-1 font-mono">ACTIVE DECK</div>
                       <div className="text-sm font-bold truncate" title={fileName}>{fileName}</div>
                   </div>
                )}
            </div>

            <div className="flex-1 mt-8 min-h-0 relative flex flex-col px-6 pb-6">
               <h2 className="text-[11px] font-bold text-[#666] uppercase tracking-widest mb-4">Trigger Log</h2>
               <div className="flex-1 overflow-y-auto bg-[#0A0A0B] border border-[#2A2A2D] rounded p-3 font-mono text-[10px] leading-relaxed text-[#AAA] overflow-x-hidden">
                   {logs.map(log => (
                       <div key={log.id} className="mb-0.5 text-[#FF4E00] animate-in fade-in duration-300 truncate">
                           {log.msg}
                       </div>
                   ))}
                   {logs.length === 0 && <span className="opacity-50"># Awaiting dispatch...</span>}
               </div>
            </div>
          </aside>

          {/* Main Console Area */}
          <section className="flex-1 flex flex-col h-[calc(100vh-4rem-2rem)] overflow-hidden">
             
             {/* Transport Header */}
             <div className="h-64 border-b border-[#2A2A2D] bg-[#121214] p-8 flex flex-col justify-between shadow-sm relative z-10 shrink-0">
                <div className="flex items-start justify-between">
                   <div className="flex gap-4">
                       <button onClick={togglePlay} disabled={!audioSrc} className="w-16 h-16 rounded bg-[#1C1C1F] border border-[#2A2A2D] hover:border-[#FF4E00] hover:text-[#FF4E00] flex items-center justify-center transition-colors disabled:opacity-50 disabled:hover:border-[#2A2A2D]">
                           {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
                       </button>
                       <button onClick={stopPlay} disabled={!audioSrc} className="w-16 h-16 rounded bg-[#1C1C1F] border border-[#2A2A2D] hover:border-[#FF4E00] hover:text-[#FF4E00] flex items-center justify-center transition-colors disabled:opacity-50 disabled:hover:border-[#2A2A2D]">
                           <Square className="w-6 h-6" />
                       </button>
                   </div>
                   
                   <div className="text-right">
                       <div className="text-[10px] text-[#666] tracking-widest uppercase mb-1 font-mono">Master Clock</div>
                       <div className="text-6xl font-black font-mono text-[#E0E0E0] tracking-tighter tabular-nums drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                           {formatTime(currentTime)}
                       </div>
                   </div>
                </div>

                <div className="mt-8 space-y-2">
                   <div className="flex justify-between text-[10px] font-mono text-[#666]">
                       <span>00:00.00</span>
                       <span>{formatTime(duration)}</span>
                   </div>
                   <input 
                      type="range" 
                      min={0} 
                      max={duration || 100} 
                      step="0.001" 
                      value={currentTime} 
                      onChange={handleSeek} 
                      disabled={!audioSrc}
                      className="w-full accent-[#FF4E00] h-3 bg-[#1C1C1F] rounded-full appearance-none cursor-pointer disabled:opacity-50 border border-[#2A2A2D]"
                   />
                </div>
             </div>

             {/* Cue Editor Area */}
             <div className="flex-1 p-8 overflow-hidden flex flex-col">
                <div className="bg-[#121214] border border-[#2A2A2D] rounded-xl shadow-xl flex-1 flex flex-col overflow-hidden">
                  <div className="flex justify-between items-center p-4 border-b border-[#2A2A2D] shrink-0 bg-[#17171A]">
                    <h2 className="text-[11px] font-bold text-[#666] uppercase tracking-widest">Master Cue List</h2>
                    <button onClick={addCue} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FF4E00]/10 border border-[#FF4E00]/30 hover:bg-[#FF4E00]/20 rounded text-[11px] font-bold text-[#FF4E00] uppercase tracking-widest transition-colors">
                      <Plus className="w-3.5 h-3.5" /> MARK CUE AT PLAYHEAD
                    </button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto bg-[#0A0A0B]">
                    <table className="w-full text-left text-sm relative border-collapse">
                      <thead className="bg-[#17171A] text-[#666] text-[10px] uppercase font-mono sticky top-0 z-10 shadow-[0_4px_10px_rgba(0,0,0,0.5)]">
                        <tr>
                          <th className="p-3 w-32 border-b border-[#2A2A2D]">Time (s)</th>
                          <th className="p-3 w-36 border-b border-[#2A2A2D]">Protocol</th>
                          <th className="p-3 w-20 border-b border-[#2A2A2D]">CH</th>
                          <th className="p-3 w-24 border-b border-[#2A2A2D]">Payload 1</th>
                          <th className="p-3 w-24 border-b border-[#2A2A2D]">Payload 2</th>
                          <th className="p-3 w-16 border-b border-[#2A2A2D]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cues.length === 0 ? (
                           <tr>
                             <td colSpan={6} className="text-center p-12 text-[#666] text-[11px] uppercase tracking-widest">
                               <Activity className="w-6 h-6 mx-auto mb-3 opacity-50" />
                               No timeline triggers assigned
                             </td>
                           </tr>
                        ) : cues.map(cue => (
                          <tr key={cue.id} className="border-b border-[#2A2A2D] hover:bg-[#1C1C1F] group transition-colors">
                            <td className="p-2">
                              <input type="number" step="0.001" value={cue.time} onChange={(e)=> updateCue(cue.id, 'time', parseFloat(e.target.value))} className="w-24 bg-transparent border border-transparent focus:border-[#FF4E00] focus:bg-[#121214] text-[#E0E0E0] p-1.5 rounded font-mono text-sm outline-none transition-all" />
                            </td>
                            <td className="p-2">
                              <select value={cue.action} onChange={(e)=> updateCue(cue.id, 'action', e.target.value as any)} className="w-32 bg-[#121214] border border-[#2A2A2D] focus:border-[#FF4E00] text-[#E0E0E0] p-1.5 rounded text-[11px] uppercase outline-none font-bold tracking-widest">
                                <option value="noteon">Note On</option>
                                <option value="cc">Control Change</option>
                              </select>
                            </td>
                            <td className="p-2">
                              <input type="number" min="1" max="16" value={cue.channel} onChange={(e)=> updateCue(cue.id, 'channel', parseInt(e.target.value))} className="w-12 bg-transparent border border-transparent focus:border-[#FF4E00] focus:bg-[#121214] text-[#E0E0E0] p-1.5 rounded font-mono text-sm outline-none" />
                            </td>
                            <td className="p-2">
                              <input type="text" value={cue.data1} onChange={(e)=> updateCue(cue.id, 'data1', e.target.value)} className="w-20 bg-transparent border border-transparent focus:border-[#FF4E00] focus:bg-[#121214] text-[#FF4E00] p-1.5 rounded font-mono font-bold text-sm outline-none" placeholder={cue.action === 'cc' ? 'CC No.' : 'Note'} />
                            </td>
                            <td className="p-2">
                              <input type="number" min="0" max="127" value={cue.data2} onChange={(e)=> updateCue(cue.id, 'data2', parseInt(e.target.value))} className="w-16 bg-transparent border border-transparent focus:border-[#FF4E00] focus:bg-[#121214] text-[#E0E0E0] p-1.5 rounded font-mono text-sm outline-none" />
                            </td>
                            <td className="p-2 text-right">
                              <button onClick={() => removeCue(cue.id)} className="text-[#666] hover:text-red-500 hover:bg-red-500/10 p-2 rounded transition-all">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
             </div>
          </section>
        </div>
      </main>
      
      {/* Footer */}
      <footer className="h-8 bg-[#121214] border-t border-[#2A2A2D] px-6 flex items-center justify-between text-[10px] text-[#666] font-mono tracking-widest uppercase z-50 shrink-0">
        <div className="flex gap-6 opacity-80">
          <div className="flex gap-1.5"><span>V OUT:</span><span className="text-[#AAA]">{vol}%</span></div>
          <div className="flex gap-1.5"><span>AUDIO ENGINE:</span><span className="text-[#AAA]">HTML5 MEDIA</span></div>
          <div className="flex gap-1.5"><span>MIDI LIB:</span><span className="text-[#AAA]">WEBMIDI.JS</span></div>
        </div>
        <div className="flex items-center gap-4">
          <input type="range" min="0" max="100" value={vol} onChange={(e) => setVol(parseInt(e.target.value))} className="w-24 accent-[#FF4E00] h-1.5 bg-[#2A2A2D] rounded-full appearance-none cursor-pointer" />
        </div>
      </footer>
    </div>
  );
}
