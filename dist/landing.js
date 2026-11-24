const canvas = document.querySelector('#terrain');
const ctx = canvas.getContext('2d');
function paint() {
  const box = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(box.width * ratio);
  canvas.height = Math.round(box.height * ratio);
  if (!canvas.width || !canvas.height) return;
  const w=700,h=370;
  ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
  const fill=ctx.createLinearGradient(0,0,w,h);
  fill.addColorStop(0,'#0c2243');fill.addColorStop(.58,'#143a71');fill.addColorStop(1,'#0b2648');
  ctx.fillStyle=fill;ctx.fillRect(0,0,w,h);
  // Contours depict a schematic signal field. They carry no geographic location claim.
  const step=5, cols=Math.ceil(w/step)+1, rows=Math.ceil(h/step)+1;
  const z=Array.from({length:rows},(_,j)=>Array.from({length:cols},(_,i)=>{
    const x=i*step,y=j*step;
    const ridge=(y-205+77*Math.sin(x/126)+29*Math.sin(x/62))/83;
    return 72*Math.exp(-ridge*ridge*.53)+14*Math.sin(x/125+y/98)+9*Math.sin(y/33+x/54)+4*Math.cos(x/23-y/31)+2.5*Math.sin(x/16+y/29);
  }));
  for(let level=-25;level<100;level+=2.25) {
    ctx.beginPath();
    for(let j=0;j<rows-1;j++) for(let i=0;i<cols-1;i++) {
      const values=[z[j][i],z[j][i+1],z[j+1][i+1],z[j+1][i]], points=[];
      const corners=[[0,0],[1,0],[1,1],[0,1]];
      for(let a=0;a<4;a++) {
        const b=(a+1)%4;
        if((values[a]<level)===(values[b]<level)) continue;
        const t=(level-values[a])/(values[b]-values[a]);
        points.push([(i+corners[a][0]+t*(corners[b][0]-corners[a][0]))*step,(j+corners[a][1]+t*(corners[b][1]-corners[a][1]))*step]);
      }
      for(let k=0;k+1<points.length;k+=2) {ctx.moveTo(...points[k]);ctx.lineTo(...points[k+1]);}
    }
    ctx.strokeStyle=level>57?'rgba(87,158,252,.74)':'rgba(78,143,226,.48)';ctx.lineWidth=level>57?1.05:.9;ctx.stroke();
  }
}
if (ctx && 'ResizeObserver' in window) {
  let scheduled;
  new ResizeObserver(() => {
    cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(paint);
  }).observe(canvas);
}

const connections = {
  A: ['Record R102', 'A placed a call to contact X'],
  B: ['Record R109', 'B placed a call to contact X'],
  X: ['Records R102 and R109', 'A and B share contact X'],
};
const markers = document.querySelectorAll('.marker');
const readoutLabel = document.querySelector('#panel-label');
const readoutTitle = document.querySelector('#panel-title');
for (const marker of markers) {
  marker.addEventListener('click', () => {
    for (const candidate of markers) {
      candidate.classList.toggle('active', candidate === marker);
      candidate.setAttribute('aria-pressed', String(candidate === marker));
    }
    const [label, title] = connections[marker.dataset.item];
    readoutLabel.textContent = label;
    readoutTitle.textContent = title;
  });
}

const workspaceMode = document.querySelector('#workspace-mode');
const bundled = location.hostname === 'appassets.androidplatform.net';
if (window.TRACEX_TEAM) {
  workspaceMode.textContent = 'Sign in with your team account. Your reviewer should use a separate account before report export.';
  document.querySelectorAll('[data-browser-only]').forEach(element => { element.hidden = true; });
} else if (bundled) {
  workspaceMode.textContent = 'The Android app includes a read-only synthetic case.';
  document.querySelectorAll('[data-field-section], [data-browser-write]').forEach(element => { element.hidden = true; });
  for (const link of document.querySelectorAll('a[href^="./console.html"]')) {
    const target = new URL(link.href);
    target.searchParams.set('demo', '1');
    link.href = target.href;
  }
}

let promptEvent;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  promptEvent = event;
});
const help = document.querySelector('#install-help');
document.querySelector('#install-button').addEventListener('click', async () => {
  if (promptEvent) {
    const event = promptEvent;
    promptEvent = undefined;
    try {
      await event.prompt();
      return;
    } catch {
      // Offer manual install instructions if the browser prompt is unavailable.
    }
  }
  help.hidden = false;
  if (matchMedia('(display-mode: standalone)').matches) {
    help.textContent = 'This web app is already installed.';
  } else if (/iPad|iPhone/i.test(navigator.userAgent)) {
    help.textContent = 'In Safari, tap Share, then Add to Home Screen.';
  } else {
    help.textContent = 'Open your browser menu and choose Install app or Add to Home screen when available.';
  }
});
