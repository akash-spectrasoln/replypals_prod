document.addEventListener('DOMContentLoaded', () => {
    const mic = document.getElementById('vb-mic');
    const textDiv = document.getElementById('vb-text');
    const actions = document.getElementById('vb-actions');
    const langSelect = document.getElementById('vb-lang');
    
    if (typeof RP_LANGUAGES !== 'undefined') {
      langSelect.innerHTML = RP_LANGUAGES.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
    }
 
    let fullText = '';
 
    function start() {
       actions.style.display = 'none';
       textDiv.textContent = '🎤 Listening... speak now';
       textDiv.style.color = '#9CA3AF';
       textDiv.style.fontStyle = 'italic';
       
       ReplyPalsVoice.start(langSelect.value, {
          onStart: () => {
             mic.classList.add('recording');
             mic.title = 'Stop recording';
          },
          onInterim: (txt) => {
             textDiv.textContent = txt;
          },
          onFinal: (txt) => {
             textDiv.textContent = txt;
             textDiv.style.color = '#1A1D2E';
             textDiv.style.fontStyle = 'normal';
          },
          onEnd: (txt) => {
             mic.classList.remove('recording');
             mic.title = 'Start recording';
             fullText = txt || '';
             textDiv.style.color = '#1A1D2E';
             textDiv.style.fontStyle = 'normal';
             if (fullText.trim().length > 2) {
                textDiv.textContent = fullText + ' (Done)';
                actions.style.display = 'grid';
             } else {
                textDiv.textContent = 'No speech detected. Click mic to try again.';
             }
          },
          onError: (msg) => {
             textDiv.textContent = msg;
             textDiv.style.color = '#EF4444';
             textDiv.style.fontStyle = 'normal';
             mic.classList.remove('recording');
             mic.title = 'Start recording';
          }
       }, true); // pass continuous = true
    }
 
    langSelect.addEventListener('change', () => {
       if (ReplyPalsVoice.getIsRecording()) {
          ReplyPalsVoice.stop();
          setTimeout(start, 300);
       }
    });
 
    mic.addEventListener('click', () => {
       if (ReplyPalsVoice.getIsRecording()) {
          ReplyPalsVoice.stop();
       } else {
          start();
       }
    });
 
    function sendAction(actionStr) {
       if (!fullText) return;
       chrome.runtime.sendMessage({ 
          type: 'VOICE_BRIDGE_RESULT', 
          payload: { text: fullText, action: actionStr } 
       }, () => {
          window.close();
       });
    }
 
    document.getElementById('vb-act-rewrite').onclick = () => sendAction('rewrite');
    document.getElementById('vb-act-generate').onclick = () => sendAction('generate');
    document.getElementById('vb-act-use').onclick = () => sendAction('use');
 
    // Auto start
    setTimeout(start, 300);
 });
