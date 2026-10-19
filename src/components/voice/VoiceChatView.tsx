import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Square,
  Volume2,
  VolumeX,
  RotateCcw,
  AlertCircle,
  Play,
  Send,
  MessageSquare,
  Radio,
  RefreshCw,
  Info,
  Globe,
  ShieldAlert,
  Sliders,
  AudioWaveform,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useHabits } from '../../context/HabitContext';

interface VoiceMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export type VoiceState =
  | 'ready'
  | 'requesting_permission'
  | 'listening'
  | 'processing'
  | 'ai_responding'
  | 'speaking'
  | 'permission_denied'
  | 'mic_unavailable'
  | 'unsupported'
  | 'connection_error';

interface IWindow extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
  AudioContext?: any;
  webkitAudioContext?: any;
}

const SUPPORTED_LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'pt-BR', label: 'Português (BR)' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'zh-CN', label: '中文 (Mandarin)' },
];

export const VoiceChatView: React.FC = () => {
  const { profile } = useAuth();
  const { habits, todayCompletionRate, currentBestStreak } = useHabits();

  // Core Voice & Session States
  const [voiceState, setVoiceState] = useState<VoiceState>('ready');
  const [conversationActive, setConversationActive] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en-US');
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [interimSpeech, setInterimSpeech] = useState<string>('');
  const [typedInput, setTypedInput] = useState<string>('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [lastAiMessage, setLastAiMessage] = useState<string>('');
  const [isSecureContext, setIsSecureContext] = useState<boolean>(true);
  const [isSpeechSupported, setIsSpeechSupported] = useState<boolean>(true);
  const [micVolume, setMicVolume] = useState<number>(0);

  const [transcriptHistory, setTranscriptHistory] = useState<VoiceMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: `Hello ${profile?.displayName || 'there'}! I am your Ritho Voice AI Coach. Click "Start Voice Chat" to speak hands-free, or type anytime below.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  // Operational References to prevent race conditions & memory leaks
  const recognitionRef = useRef<any>(null);
  const isStartingRecognitionRef = useRef<boolean>(false);
  const isManuallyStoppedRef = useRef<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);
  const isSpeakingRef = useRef<boolean>(false);
  const lastSubmittedTextRef = useRef<string>('');
  const activeMediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const speechDebounceTimerRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check secure context and browser capability on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const secure =
        window.isSecureContext ??
        (window.location.protocol === 'https:' ||
          window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1');
      setIsSecureContext(Boolean(secure));

      const win = window as unknown as IWindow;
      const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (!SpeechRecognitionClass) {
        setIsSpeechSupported(false);
        setVoiceState('unsupported');
      } else {
        setIsSpeechSupported(true);
      }
    }
  }, []);

  // Auto-scroll transcript container
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptHistory, liveTranscript, interimSpeech, voiceState]);

  // Cleanup all audio resources and timers on unmount
  useEffect(() => {
    return () => {
      terminateAllVoiceResources();
    };
  }, []);

  // Stop hardware mic stream and release audio context
  const releaseMediaStream = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (activeMediaStreamRef.current) {
      activeMediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      activeMediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setMicVolume(0);
  }, []);

  // Terminate every running voice service (recognition, TTS, streams)
  const terminateAllVoiceResources = useCallback(() => {
    isManuallyStoppedRef.current = true;
    isSubmittingRef.current = false;
    isSpeakingRef.current = false;

    if (speechDebounceTimerRef.current) {
      clearTimeout(speechDebounceTimerRef.current);
      speechDebounceTimerRef.current = null;
    }

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    // Stop speech synthesis
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    releaseMediaStream();
  }, [releaseMediaStream]);

  // Setup real-time audio volume visualizer from microphone stream
  const setupAudioVisualizer = (stream: MediaStream) => {
    try {
      const win = window as unknown as IWindow;
      const AudioCtx = win.AudioContext || win.webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setMicVolume(normalized);

        animFrameRef.current = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (err) {
      console.warn('Audio visualizer setup error:', err);
    }
  };

  // 1. Acquire & Verify Microphone Access
  const requestMicrophoneAccess = async (): Promise<boolean> => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setVoiceState('mic_unavailable');
      setVoiceError('Microphone audio capture is not supported by this browser environment.');
      return false;
    }

    setVoiceState('requesting_permission');
    setVoiceError(null);

    try {
      // Request mic permission on user click
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      activeMediaStreamRef.current = stream;
      setupAudioVisualizer(stream);
      return true;
    } catch (err: any) {
      console.warn('Microphone getUserMedia error:', err);
      if (
        err.name === 'NotAllowedError' ||
        err.name === 'PermissionDeniedError' ||
        err.message?.includes('Permission denied')
      ) {
        setVoiceState('permission_denied');
        setVoiceError(
          'Microphone permission was denied. Please allow microphone access in your browser address bar and retry.'
        );
      } else if (
        err.name === 'NotFoundError' ||
        err.name === 'DevicesNotFoundError' ||
        err.message?.includes('device not found')
      ) {
        setVoiceState('mic_unavailable');
        setVoiceError('No microphone hardware was detected. Please connect an audio input device.');
      } else {
        setVoiceState('connection_error');
        setVoiceError(`Audio device error: ${err.message || 'Unable to access microphone'}`);
      }
      return false;
    }
  };

  // 2. Speech Synthesis: Speak text aloud
  const speakText = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setVoiceState(conversationActive ? 'ready' : 'ready');
      return;
    }

    // Stop previous utterance
    window.speechSynthesis.cancel();

    if (isMuted) {
      // If user muted audio output, return to listening or ready
      if (conversationActive && !isManuallyStoppedRef.current) {
        startListeningSession();
      } else {
        setVoiceState('ready');
      }
      return;
    }

    isSpeakingRef.current = true;
    setVoiceState('speaking');

    try {
      // Clean markdown characters for natural voice playback
      const plainText = text.replace(/[*#_~`]/g, '').trim();
      const utterance = new SpeechSynthesisUtterance(plainText);
      utterance.lang = selectedLanguage;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Select matching voice
      const voices = window.speechSynthesis.getVoices();
      const targetLangPrefix = selectedLanguage.split('-')[0];
      const targetVoice = voices.find(
        (v) =>
          v.lang.startsWith(targetLangPrefix) ||
          v.name.toLowerCase().includes('natural') ||
          v.name.toLowerCase().includes('google')
      );
      if (targetVoice) {
        utterance.voice = targetVoice;
      }

      utterance.onstart = () => {
        isSpeakingRef.current = true;
        setVoiceState('speaking');
      };

      utterance.onend = () => {
        isSpeakingRef.current = false;
        // Resume continuous listening automatically if conversation is active
        if (conversationActive && !isManuallyStoppedRef.current) {
          startListeningSession();
        } else {
          setVoiceState('ready');
        }
      };

      utterance.onerror = (e) => {
        console.warn('SpeechSynthesis error:', e);
        isSpeakingRef.current = false;
        if (conversationActive && !isManuallyStoppedRef.current) {
          startListeningSession();
        } else {
          setVoiceState('ready');
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis playback failed:', err);
      isSpeakingRef.current = false;
      setVoiceState('ready');
    }
  };

  const stopAiSpeech = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    isSpeakingRef.current = false;
    if (voiceState === 'speaking') {
      setVoiceState('ready');
    }
  };

  const replayLastAiResponse = () => {
    if (lastAiMessage) {
      speakText(lastAiMessage);
    }
  };

  // 3. Speech Recognition Engine
  const startListeningSession = useCallback(() => {
    stopAiSpeech();
    isManuallyStoppedRef.current = false;
    setVoiceError(null);

    const win = window as unknown as IWindow;
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setVoiceState('unsupported');
      setVoiceError('Speech recognition is not supported in this browser. Use text chat below.');
      return;
    }

    // Guard against simultaneous start calls
    if (isStartingRecognitionRef.current) return;
    isStartingRecognitionRef.current = true;

    // Abort existing session if running
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = selectedLanguage;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        isStartingRecognitionRef.current = false;
        setVoiceState('listening');
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let finalized = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const chunk = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            finalized += chunk;
          } else {
            interim += chunk;
          }
        }

        if (interim) {
          setInterimSpeech(interim);
        }

        if (finalized.trim()) {
          setLiveTranscript(finalized.trim());
          setInterimSpeech('');

          // Debounce to allow user natural pauses before sending to Gemini
          if (speechDebounceTimerRef.current) {
            clearTimeout(speechDebounceTimerRef.current);
          }
          speechDebounceTimerRef.current = setTimeout(() => {
            submitRecognizedSpeech(finalized.trim());
          }, 450);
        }
      };

      recognition.onerror = (event: any) => {
        isStartingRecognitionRef.current = false;
        const errType = event.error;
        console.warn('SpeechRecognition event error:', errType);

        if (errType === 'not-allowed') {
          setVoiceState('permission_denied');
          setVoiceError('Microphone permission blocked. Please allow microphone in browser settings.');
        } else if (errType === 'audio-capture') {
          setVoiceState('mic_unavailable');
          setVoiceError('No microphone hardware detected or audio is in use by another program.');
        } else if (errType === 'no-speech') {
          // Normal pause in speaking, do not terminate session if user wants to keep chatting
          if (conversationActive && !isManuallyStoppedRef.current) {
            // Keep listening
          }
        } else if (errType === 'aborted') {
          // Expected when stopped programmatically
        } else if (errType === 'network') {
          setVoiceState('connection_error');
          setVoiceError('Network connection issue during speech recognition. Please retry.');
        } else {
          setVoiceError(`Speech service: ${errType}`);
        }
      };

      recognition.onend = () => {
        isStartingRecognitionRef.current = false;
        // Auto-restart if session is still active and not paused for AI speaking or manually stopped
        if (
          conversationActive &&
          !isManuallyStoppedRef.current &&
          !isSubmittingRef.current &&
          !isSpeakingRef.current &&
          voiceState !== 'processing' &&
          voiceState !== 'ai_responding' &&
          voiceState !== 'speaking'
        ) {
          try {
            recognition.start();
          } catch {
            // ignore
          }
        }
      };

      recognition.start();
    } catch (err: any) {
      isStartingRecognitionRef.current = false;
      console.error('Failed to initialize speech recognition:', err);
      setVoiceState('connection_error');
      setVoiceError(err.message || 'Could not start voice recognition.');
    }
  }, [selectedLanguage, conversationActive, voiceState]);

  // Stop Listening action (pauses recognition without ending conversation)
  const handleStopListening = () => {
    isManuallyStoppedRef.current = true;
    if (speechDebounceTimerRef.current) {
      clearTimeout(speechDebounceTimerRef.current);
      speechDebounceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    releaseMediaStream();
    setVoiceState('ready');
  };

  // Start Voice Chat action
  const handleStartVoiceChat = async () => {
    setVoiceError(null);
    setConversationActive(true);
    isManuallyStoppedRef.current = false;

    // Acquire mic permission and setup visualizer
    const granted = await requestMicrophoneAccess();
    if (!granted) {
      setConversationActive(false);
      return;
    }

    startListeningSession();
  };

  // End Conversation action
  const handleEndConversation = () => {
    setConversationActive(false);
    terminateAllVoiceResources();
    setLiveTranscript('');
    setInterimSpeech('');
    setVoiceState('ready');
  };

  // 4. Submit recognized speech or typed prompt to Gemini AI Coach
  const submitRecognizedSpeech = async (speechText: string) => {
    if (!speechText.trim() || isSubmittingRef.current) return;

    // Prevent duplicate rapid submissions of identical text
    if (speechText.trim() === lastSubmittedTextRef.current) return;

    isSubmittingRef.current = true;
    lastSubmittedTextRef.current = speechText.trim();
    setLiveTranscript('');
    setInterimSpeech('');

    // Temporarily pause recognition so mic does not hear system speech
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }

    setVoiceState('processing');

    const userMessage: VoiceMessage = {
      id: 'voice_u_' + Date.now(),
      sender: 'user',
      text: speechText.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setTranscriptHistory((prev) => [...prev, userMessage]);

    try {
      setVoiceState('ai_responding');

      const habitSummaries = habits.map((h) => `${h.title} (${h.category})`).join(', ') || 'No habits added yet';
      const context = {
        userName: profile?.displayName || 'Friend',
        habitsSummary: habitSummaries,
        completionRate: `${todayCompletionRate}% completed today`,
        currentStreaks: `${currentBestStreak} days streak`,
      };

      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: speechText.trim(),
          history: transcriptHistory.slice(-4).map((m) => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text,
          })),
          context,
        }),
      });

      if (!res.ok) {
        throw new Error('AI Coach service temporarily busy. Please retry.');
      }

      const data = await res.json();
      const aiReply =
        data.reply ||
        'Every small positive habit completed today lays the foundation for your long-term success. Keep up the great work!';

      const aiMessage: VoiceMessage = {
        id: 'voice_ai_' + Date.now(),
        sender: 'assistant',
        text: aiReply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setTranscriptHistory((prev) => [...prev, aiMessage]);
      setLastAiMessage(aiReply);
      isSubmittingRef.current = false;

      // Speak response aloud through speech synthesis
      speakText(aiReply);
    } catch (err: any) {
      console.error('AI Voice chat pipeline error:', err);
      setVoiceState('connection_error');
      setVoiceError(err.message || 'Could not receive AI response. Your message was preserved.');
      isSubmittingRef.current = false;
    }
  };

  // Fallback text submit
  const handleSendTyped = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedInput.trim()) return;
    const text = typedInput;
    setTypedInput('');
    submitRecognizedSpeech(text);
  };

  // Clear Transcript action
  const handleClearTranscript = () => {
    stopAiSpeech();
    setTranscriptHistory([
      {
        id: 'welcome_' + Date.now(),
        sender: 'assistant',
        text: 'Transcript cleared. Click "Start Voice Chat" to begin a new voice session.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setLiveTranscript('');
    setInterimSpeech('');
    setLastAiMessage('');
  };

  // Map state to human-readable status badge & colors
  const getStatusBadge = () => {
    switch (voiceState) {
      case 'requesting_permission':
        return {
          label: 'Requesting microphone permission...',
          color: 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse',
        };
      case 'listening':
        return {
          label: 'Listening to your voice...',
          color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        };
      case 'processing':
        return {
          label: 'Processing your message...',
          color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 animate-pulse',
        };
      case 'ai_responding':
        return {
          label: 'AI is responding...',
          color: 'bg-violet-500/20 text-violet-300 border-violet-500/40 animate-pulse',
        };
      case 'speaking':
        return {
          label: 'Speaking AI response aloud...',
          color: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
        };
      case 'permission_denied':
        return {
          label: 'Microphone permission denied',
          color: 'bg-red-500/20 text-red-300 border-red-500/40',
        };
      case 'mic_unavailable':
        return {
          label: 'Microphone unavailable',
          color: 'bg-red-500/20 text-red-300 border-red-500/40',
        };
      case 'unsupported':
        return {
          label: 'Browser speech recognition not supported',
          color: 'bg-neutral-800 text-neutral-400 border-neutral-700',
        };
      case 'connection_error':
        return {
          label: 'Connection error',
          color: 'bg-red-500/20 text-red-300 border-red-500/40',
        };
      default:
        return conversationActive
          ? {
              label: 'Voice session active (idle)',
              color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
            }
          : {
              label: 'Ready to start voice chat',
              color: 'bg-neutral-800/80 text-neutral-300 border-neutral-700/80',
            };
    }
  };

  const status = getStatusBadge();

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      {/* HTTPS / Secure Context check banner */}
      {!isSecureContext && (
        <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <strong>Insecure Context:</strong> Web audio and speech APIs require HTTPS or localhost. If audio capture is restricted, please access Ritho AI over HTTPS.
          </div>
        </div>
      )}

      {/* Header and Controls Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-neutral-800/80">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">Ritho Voice AI</h1>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold border border-emerald-500/30 flex items-center gap-1">
              <Radio className="w-3 h-3 animate-pulse" />
              Live Conversation
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Real-time speech recognition, Gemini intelligence & natural voice synthesis
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Language Selector */}
          <div className="flex items-center gap-1.5 bg-[#141724] border border-neutral-800 rounded-xl px-2.5 py-1 text-xs">
            <Globe className="w-3.5 h-3.5 text-neutral-400" />
            <select
              value={selectedLanguage}
              onChange={(e) => {
                setSelectedLanguage(e.target.value);
                if (conversationActive && voiceState === 'listening') {
                  startListeningSession();
                }
              }}
              className="bg-transparent text-xs text-neutral-200 focus:outline-none cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code} className="bg-[#141724] text-white">
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          {/* Mute AI Speech Synthesis */}
          <button
            onClick={() => {
              if (voiceState === 'speaking') stopAiSpeech();
              setIsMuted(!isMuted);
            }}
            title={isMuted ? 'Unmute AI voice response' : 'Mute AI voice response'}
            className={`p-2 rounded-xl border text-xs flex items-center gap-1.5 transition-colors ${
              isMuted
                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                : 'bg-[#141724] border-neutral-800 text-neutral-300 hover:text-white'
            }`}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            <span className="text-[11px] hidden sm:inline">{isMuted ? 'Voice Muted' : 'Voice On'}</span>
          </button>

          {/* Clear Transcript */}
          <button
            onClick={handleClearTranscript}
            title="Clear transcript history"
            className="p-2 rounded-xl bg-[#141724] border border-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">Clear</span>
          </button>
        </div>
      </div>

      {/* Main Interactive Orb & Voice Control Hub */}
      <div className="rounded-3xl bg-gradient-to-b from-[#131627] to-[#0e101c] border border-neutral-800/80 p-6 sm:p-8 flex flex-col items-center justify-center text-center relative overflow-hidden shadow-2xl min-h-[340px]">
        {/* Glow backdrop */}
        <div className="absolute inset-0 bg-violet-600/5 backdrop-blur-3xl pointer-events-none" />

        {/* State Badge */}
        <div className={`relative z-10 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium border mb-6 ${status.color}`}>
          <span
            className={`w-2 h-2 rounded-full ${
              voiceState === 'listening'
                ? 'bg-emerald-400 animate-ping'
                : voiceState === 'processing' || voiceState === 'ai_responding'
                ? 'bg-indigo-400 animate-pulse'
                : voiceState === 'speaking'
                ? 'bg-violet-400 animate-pulse'
                : voiceState === 'permission_denied' || voiceState === 'mic_unavailable'
                ? 'bg-red-400'
                : 'bg-neutral-500'
            }`}
          />
          <span>{status.label}</span>
        </div>

        {/* Central Reactive Microphone Orb */}
        <div className="relative z-10 mb-6 flex items-center justify-center">
          {/* Animated sound ripple rings */}
          {voiceState === 'listening' && (
            <>
              <div
                className="absolute rounded-full border border-emerald-500/40 animate-ping pointer-events-none"
                style={{
                  width: `${120 + micVolume * 0.8}px`,
                  height: `${120 + micVolume * 0.8}px`,
                }}
              />
              <div
                className="absolute rounded-full bg-emerald-500/10 pointer-events-none transition-all duration-75"
                style={{
                  width: `${110 + micVolume * 0.6}px`,
                  height: `${110 + micVolume * 0.6}px`,
                }}
              />
            </>
          )}

          {voiceState === 'speaking' && (
            <>
              <div className="absolute w-44 h-44 rounded-full border border-violet-500/50 animate-ripple pointer-events-none" />
              <div className="absolute w-36 h-36 rounded-full bg-violet-500/20 animate-pulse-glow pointer-events-none" />
            </>
          )}

          <button
            onClick={
              conversationActive
                ? voiceState === 'listening'
                  ? handleStopListening
                  : startListeningSession
                : handleStartVoiceChat
            }
            title={
              conversationActive
                ? voiceState === 'listening'
                  ? 'Click to pause listening'
                  : 'Click to resume listening'
                : 'Click to start voice chat'
            }
            className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl relative z-10 ${
              voiceState === 'listening'
                ? 'bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-emerald-500/40 scale-105'
                : voiceState === 'speaking'
                ? 'bg-gradient-to-tr from-violet-600 to-indigo-500 text-white shadow-violet-600/40 animate-pulse'
                : voiceState === 'processing' || voiceState === 'ai_responding'
                ? 'bg-gradient-to-tr from-indigo-700 to-violet-800 text-white shadow-indigo-500/30'
                : 'bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-violet-600/30 hover:scale-105'
            }`}
          >
            {voiceState === 'listening' ? (
              <Mic className="w-10 h-10 animate-bounce" />
            ) : voiceState === 'speaking' ? (
              <Volume2 className="w-10 h-10 animate-pulse" />
            ) : (
              <Mic className="w-10 h-10" />
            )}
          </button>
        </div>

        {/* Live Audio Visualizer Bars when listening */}
        {voiceState === 'listening' && (
          <div className="relative z-10 flex items-center justify-center gap-1.5 mb-4 h-8">
            <span className="text-[10px] text-emerald-400 font-semibold mr-1 flex items-center gap-1">
              <AudioWaveform className="w-3.5 h-3.5" /> Mic Input:
            </span>
            {[14, 24, 32, 20, 16, 28, 18].map((h, idx) => {
              const dynamicHeight = Math.max(6, Math.min(32, (h * (micVolume + 15)) / 40));
              return (
                <div
                  key={idx}
                  className="w-1.5 rounded-full bg-emerald-400/80 transition-all duration-75"
                  style={{ height: `${dynamicHeight}px` }}
                />
              );
            })}
          </div>
        )}

        {/* Real-time recognized speech preview */}
        {(liveTranscript || interimSpeech) && (
          <div className="relative z-10 max-w-lg mx-auto p-3.5 rounded-2xl bg-[#191c2e]/95 border border-violet-500/30 text-violet-200 text-xs font-medium animate-fadeIn mb-4 shadow-lg text-left">
            <span className="text-[10px] text-neutral-400 block mb-0.5 uppercase tracking-wider font-semibold">
              Live Speech Transcript:
            </span>
            <p className="text-white">
              "{liveTranscript || interimSpeech}"
            </p>
          </div>
        )}

        {/* Functional Voice Controls Button Bar */}
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-2.5 mt-2">
          {!conversationActive ? (
            <button
              onClick={handleStartVoiceChat}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-xl transition-all shadow-lg shadow-violet-600/25 flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Start Voice Chat</span>
            </button>
          ) : (
            <>
              {voiceState === 'listening' ? (
                <button
                  onClick={handleStopListening}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-xl transition-colors flex items-center gap-2 shadow-md shadow-amber-600/20"
                >
                  <MicOff className="w-4 h-4" />
                  <span>Stop Listening</span>
                </button>
              ) : (
                <button
                  onClick={startListeningSession}
                  disabled={voiceState === 'processing' || voiceState === 'ai_responding'}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium rounded-xl transition-colors flex items-center gap-2 shadow-md shadow-emerald-600/20"
                >
                  <Mic className="w-4 h-4" />
                  <span>Resume Listening</span>
                </button>
              )}

              {/* Stop AI Speech Button */}
              {voiceState === 'speaking' && (
                <button
                  onClick={stopAiSpeech}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-xl transition-colors flex items-center gap-2"
                >
                  <VolumeX className="w-4 h-4 text-violet-400" />
                  <span>Stop AI Speech</span>
                </button>
              )}

              {/* Replay AI Response Button */}
              {lastAiMessage && voiceState !== 'speaking' && (
                <button
                  onClick={replayLastAiResponse}
                  className="px-3.5 py-2 bg-[#181b2c] hover:bg-[#20243b] border border-neutral-700 text-neutral-200 text-xs font-medium rounded-xl transition-colors flex items-center gap-1.5"
                >
                  <Volume2 className="w-3.5 h-3.5 text-violet-400" />
                  <span>Replay AI Response</span>
                </button>
              )}

              {/* End Conversation */}
              <button
                onClick={handleEndConversation}
                className="px-4 py-2 bg-[#1c1f30] hover:bg-red-500/20 border border-neutral-700 hover:border-red-500/40 text-neutral-300 hover:text-red-300 text-xs font-medium rounded-xl transition-colors flex items-center gap-2"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>End Conversation</span>
              </button>
            </>
          )}
        </div>

        {/* Detailed Permission Denied Diagnostics & Instructions */}
        {voiceState === 'permission_denied' && (
          <div className="relative z-10 mt-6 p-4 rounded-2xl bg-red-950/40 border border-red-500/30 text-xs text-red-300 text-left max-w-lg space-y-2">
            <div className="flex items-center gap-2 font-bold text-red-200">
              <AlertCircle className="w-4 h-4 text-red-400" />
              How to enable microphone access in your browser:
            </div>
            <ol className="list-decimal ml-4 space-y-1 text-[11px] text-red-300">
              <li>Click the 🔒 lock or 🎙️ microphone icon on the left side of your browser URL bar.</li>
              <li>Change <strong>Microphone</strong> from <em>Block</em> to <strong>Allow</strong>.</li>
              <li>Click the retry button below to reactivate voice chat.</li>
            </ol>
            <div className="pt-1">
              <button
                onClick={handleStartVoiceChat}
                className="px-3.5 py-1.5 bg-red-800 hover:bg-red-700 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Microphone Access</span>
              </button>
            </div>
          </div>
        )}

        {/* Unsupported browser fallback notice */}
        {voiceState === 'unsupported' && (
          <div className="relative z-10 mt-6 p-4 rounded-2xl bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 text-left max-w-lg space-y-2">
            <div className="flex items-center gap-2 font-bold text-white">
              <Info className="w-4 h-4 text-violet-400" />
              Browser Speech Recognition Notice
            </div>
            <p className="text-[11px] text-neutral-400">
              Your current browser does not have the native Web Speech Recognition API. Chrome, Edge, and Safari provide full microphone recognition. You can still type below to chat with the AI, and hear responses spoken aloud!
            </p>
          </div>
        )}

        {/* Connection or Hardware error notice */}
        {voiceError && voiceState !== 'permission_denied' && voiceState !== 'unsupported' && (
          <div className="relative z-10 mt-4 p-3 rounded-xl bg-red-950/30 border border-red-500/20 text-red-300 text-xs flex items-center gap-2 text-left max-w-lg">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{voiceError}</span>
          </div>
        )}

        {/* Architectural pipeline footnote */}
        <div className="relative z-10 mt-6 flex items-center gap-1.5 text-[10px] text-neutral-500">
          <Info className="w-3 h-3" />
          <span>Pipeline: SpeechRecognition (browser) → Gemini AI Coach (server) → SpeechSynthesis (voice audio).</span>
        </div>
      </div>

      {/* Conversation Transcript & Working Text Message Fallback */}
      <div className="rounded-2xl bg-[#111320] border border-neutral-800/80 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-violet-400" />
            <span>Conversation Transcript</span>
          </h2>
          <span className="text-[11px] text-neutral-400">{transcriptHistory.length} messages</span>
        </div>

        <div className="max-h-72 overflow-y-auto space-y-3 pr-2 scrollbar-none">
          {transcriptHistory.map((item) => {
            const isUser = item.sender === 'user';
            return (
              <div
                key={item.id}
                className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-[85%] ${
                  isUser
                    ? 'ml-auto bg-gradient-to-r from-violet-600 to-indigo-600 text-white'
                    : 'bg-[#181a29] border border-neutral-800 text-neutral-200'
                }`}
              >
                <div className="flex items-center justify-between gap-3 text-[10px] text-neutral-400 mb-1 opacity-75">
                  <span className="font-semibold text-neutral-300">
                    {isUser ? 'You' : 'Ritho AI Coach'}
                  </span>
                  <span>{item.timestamp}</span>
                </div>
                <p>{item.text}</p>
                {!isUser && (
                  <button
                    onClick={() => speakText(item.text)}
                    className="mt-2 text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-1 transition-colors"
                  >
                    <Volume2 className="w-3 h-3" /> Replay this reply
                  </button>
                )}
              </div>
            );
          })}
          <div ref={scrollRef} />
        </div>

        {/* Send Message Input: Working text fallback and voice edit */}
        <form onSubmit={handleSendTyped} className="pt-2 border-t border-neutral-800/60 flex items-center gap-2">
          <input
            type="text"
            value={typedInput}
            onChange={(e) => setTypedInput(e.target.value)}
            placeholder="Type or edit your message for the Voice Coach..."
            disabled={voiceState === 'processing' || voiceState === 'ai_responding'}
            className="flex-1 bg-[#181a29] border border-neutral-700/70 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            disabled={!typedInput.trim() || voiceState === 'processing' || voiceState === 'ai_responding'}
            className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-violet-600/20"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send Message</span>
          </button>
        </form>
      </div>
    </div>
  );
};
