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
let scheduled;new ResizeObserver(()=>{cancelAnimationFrame(scheduled);scheduled=requestAnimationFrame(paint)}).observe(canvas);
const labels={A:['SUBJECT A','A placed a call to contact X'],B:['SUBJECT B','B placed a call to contact X'],X:['SELECTED CONNECTION','A and B share contact X']};
document.querySelectorAll('.marker').forEach(el=>el.addEventListener('click',()=>{
  document.querySelectorAll('.marker').forEach(other=>{other.classList.toggle('active',other===el);other.setAttribute('aria-pressed',String(other===el))});
  const [label,title]=labels[el.dataset.item];document.getElementById('panel-label').textContent=label;document.getElementById('panel-title').textContent=title;
}));
let promptEvent;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();promptEvent=e});
const help=document.querySelector('#install-help');
document.querySelector('#install-button').addEventListener('click',async()=>{
  if(promptEvent){await promptEvent.prompt();await promptEvent.userChoice;promptEvent=null;return}
  help.hidden=false;help.textContent=matchMedia('(display-mode: standalone)').matches?'This web app is already installed.':/iPad|iPhone/i.test(navigator.userAgent)?'In Safari, tap Share, then Add to Home Screen.':'Open your browser menu and choose Install app or Add to Home screen when available.';
});
