// voice-engine.js
// Shared voice recognition engine for ReplyPals
// Used by both content.js and popup.js

const RP_TONES = [
  { id:'Confident', icon:'💪', color:'#3B82F6', desc:'Direct, strong' },
  { id:'Polite',    icon:'🤝', color:'#F59E0B', desc:'Warm, considerate'},
  { id:'Casual',    icon:'😊', color:'#10B981', desc:'Light, relaxed' },
  { id:'Formal',    icon:'📋', color:'#6B7280', desc:'Professional, clear'},
  { id:'Friendly',  icon:'👋', color:'#EC4899', desc:'Approachable, kind'},
  { id:'Assertive', icon:'🔥', color:'#8B5CF6', desc:'Firm, confident' }
];

const RP_LANGUAGES = [
  { code:'auto', label:'Auto-detect' },
  { code:'en',   label:'English' },
  { code:'ml',   label:'🇮🇳 Malayalam → English' },
  { code:'hi',   label:'🇮🇳 Hindi → English' },
  { code:'ar',   label:'🇸🇦 Arabic → English' },
  { code:'tl',   label:'🇵🇭 Filipino → English' },
  { code:'pt',   label:'🇧🇷 Portuguese → English'},
  { code:'es',   label:'🇪🇸 Spanish → English' },
  { code:'fr',   label:'🇫🇷 French → English' }
];

const ReplyPalsVoice = (() => {

  const LANG_MAP = {
    'en':   'en-IN',
    'hi':   'hi-IN',
    'ml':   'ml-IN',
    'ar':   'ar-SA',
    'tl':   'fil-PH',
    'pt':   'pt-BR',
    'es':   'es-ES',
    'fr':   'fr-FR',
    'auto': 'en-IN',
  };

  const SpeechRecognition = 
    window.SpeechRecognition || 
    window.webkitSpeechRecognition;

  let recognition   = null;
  let isRecording   = false;
  let intentionalStop = false;
  let finalTranscript = '';
  let callbacks     = {};
  let currentLang   = 'auto';
  let isContinuous  = false;

  function isSupported() {
    return !!SpeechRecognition;
  }

  function init(lang = 'auto', continuous = false) {
    if (!SpeechRecognition) return false;
    if (recognition) destroy();

    currentLang = lang;
    isContinuous = continuous;

    recognition = new SpeechRecognition();
    recognition.continuous     = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = LANG_MAP[lang] || 'en-IN';

    recognition.onstart = () => {
      isRecording = true;
      intentionalStop = false;
      callbacks.onStart?.();
    };

    recognition.onresult = (event) => {
      let interim = '';
      let sessionFinal = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          let text = event.results[i][0].transcript;
          sessionFinal += text + (text.endsWith(' ') ? '' : ' ');
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (sessionFinal) {
        finalTranscript += sessionFinal;
        callbacks.onFinal?.(finalTranscript.trim());
      } 
      if (interim) {
        callbacks.onInterim?.(finalTranscript + interim);
      }
    };

    recognition.onend = () => {
      if (isContinuous && !intentionalStop) {
        try { recognition.start(); } catch(e) {}
        return;
      }
      isRecording = false;
      callbacks.onEnd?.(finalTranscript.trim());
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' && isContinuous && !intentionalStop) {
        // Ignore timeouts in continuous mode, onend will restart it
        return;
      }
      const errors = {
        'not-allowed':    'Microphone access denied. Click 🔒 in address bar → Allow.',
        'network':        'Network error. Check connection.',
        'audio-capture':  'No microphone found.',
      };
      const msg = errors[event.error];
      if (msg) {
        intentionalStop = true;
        callbacks.onError?.(msg);
      }
    };

    return true;
  }

  function start(lang, cbs, continuous = false) {
    callbacks = cbs || {};
    if (!recognition || recognition.lang !== (LANG_MAP[lang] || 'en-IN') || isContinuous !== continuous) {
      init(lang, continuous);
    }
    if (isRecording) { stop(); return; }
    try {
      finalTranscript = '';
      intentionalStop = false;
      recognition.start();
    } catch(e) {
      destroy();
      init(lang, continuous);
      recognition.start();
    }
  }

  function stop() {
    if (recognition && isRecording) {
      intentionalStop = true;
      recognition.stop();
    }
  }

  function destroy() {
    if (recognition) {
      intentionalStop = true;
      try { recognition.abort(); } catch(e) {}
      recognition = null;
      isRecording  = false;
    }
  }

  function getIsRecording() { return isRecording && !intentionalStop; }
  function getTranscript()  { return finalTranscript.trim(); }
  function getLangCode(lang){ return LANG_MAP[lang] || 'en-IN'; }

  return { 
    isSupported, init, start, stop, 
    destroy, getIsRecording, getTranscript, getLangCode 
  };
})();

// Export for content.js (injected) and popup.js
if (typeof module !== 'undefined') {
  module.exports = { ReplyPalsVoice, RP_TONES, RP_LANGUAGES };
}
