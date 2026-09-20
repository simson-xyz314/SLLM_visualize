const NS='http://www.w3.org/2000/svg';

const el={
  stage:document.getElementById('traceStage'),
  svg:document.getElementById('traceSvg'),
  source:document.getElementById('source'),
  answer:document.getElementById('answer'),
  form:document.getElementById('traceForm'),
  input:document.getElementById('traceInput'),
  hint:document.getElementById('formHint'),
  name:document.getElementById('traceName'),
  metric:document.getElementById('metric'),
  reset:document.getElementById('resetBtn'),
  stageInfo:document.getElementById('stageInfo'),
  stageTitle:document.getElementById('stageTitle'),
  stageSub:document.getElementById('stageSub'),
  decoy:document.getElementById('decoyText'),
  suggest:document.getElementById('suggestions')
};
let runId=0;
const defaultHint=el.hint.textContent;
const wait=ms=>new Promise(r=>setTimeout(r,ms));

// ---- 작은 DOM/유틸 헬퍼 ----
function n(k,a={},v=''){
  const e=document.createElementNS(NS,k);
  Object.entries(a).forEach(([x,y])=>e.setAttribute(x,y));
  e.textContent=v;
  return e;
}
function t(x,y,v,c=''){return n('text',{x,y,class:c},v)}
function line(x1,y1,x2,y2,c='txWire'){return n('line',{x1,y1,x2,y2,class:c})}
function dot(x,y,r=5,c='txDot'){return n('circle',{cx:x,cy:y,r,class:c})}
function show(v){return v.replace(/^ /,'·').replace(/\n/g,'↵')||'∅'}
function words(v){return v.trim().split(/\s+/).filter(Boolean)}
function shuffle(arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
// ms 동안 fn(e)를 매 프레임 호출한다(e: 0→1 ease-out). token이 바뀌면(다른 실행이
// 시작되면) 스스로 멈춘다.
function anim(ms,fn,token){
  return new Promise(done=>{
    const start=performance.now();
    function go(now){
      if(token!==undefined&&token!==runId){done();return}
      const q=Math.min(1,(now-start)/ms),e=1-Math.pow(1-q,3);
      fn(e);
      q<1?requestAnimationFrame(go):done();
    }
    requestAnimationFrame(go);
  });
}
// 실제로 렌더링되는 요소를 그대로 재서 폭을 구한다(캔버스 추정은 폰트가 미세하게
// 어긋나 누적 오차가 생긴다). styleExtra로 폰트 크기 등을 덮어써 잴 수 있다.
function measureText(str,cls,styleExtra){
  const tmp=t(-9999,-9999,str,cls);
  if(styleExtra)tmp.style.cssText=styleExtra;
  el.svg.append(tmp);
  const w=tmp.getComputedTextLength();
  tmp.remove();
  return w;
}

// ---- 2D 플랫포머 카메라 ----
// 배율(뷰 폭/높이)은 평소 고정한 채, 화면 중앙 대역(데드존) 안에서는 빛이 자기
// 좌표(heroWorldX)를 따라 실제로 움직이고, 카메라는 가만히 있는다. 빛이 그 대역을
// 벗어나려 할 때만 카메라가 뒤따라 움직인다 — 그래서 "빛이 선을 타고 이동"하는 것과
// "화면이 움직이는" 것이 뒤섞이지 않고 구분되어 보인다.
const VB_W0=990,VB_H0=500,DZ_L=0.35,DZ_R=0.65;
let VB_W=VB_W0,VB_H=VB_H0,targetVBW=VB_W0,targetVBH=VB_H0,camRate=0.11;
let camX=0,targetX=0,camY=0,targetY=0,followOn=false;
let heroEl=null,heroOverride=false,heroWorldX=0,centerGen=0;
// 메인라인의 현재 y좌표 — 평소엔 430으로 고정이지만, 임베딩 장에서 레일이
// 박스 아래로 꺾여 내려가면서 그 이후 구간(메인라인 2)은 다른 높이에 놓인다.
// 그 뒤에 오는 단계들은 430을 직접 쓰지 않고 이 값을 읽어야 새 높이를 따라간다.
let railY=430;

// centerOn은 빛을 목표 좌표까지 부드럽게 "이동"시킨다(카메라를 직접 옮기지 않는다).
// 카메라는 매 프레임 아래 follow 루프에서 이 이동을 보고 반응한다. token을 넘기면
// 도중에 다른 실행으로 넘어갔을 때 스스로 멈춘다.
function centerOn(x,token){
  const gen=++centerGen,start=heroWorldX,dist=x-start;
  if(Math.abs(dist)<1){heroWorldX=x;return Promise.resolve()}
  const dur=Math.min(1100,Math.max(320,Math.abs(dist)*0.5)),t0=performance.now();
  return new Promise(done=>{
    function step(now){
      if(gen!==centerGen||(token!==undefined&&token!==runId)){done();return}
      const q=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-q,3);
      heroWorldX=start+dist*e;
      if(q<1)requestAnimationFrame(step);else done();
    }
    requestAnimationFrame(step);
  });
}
// 문장(혹은 숫자로 바뀐 문장)이 화면 폭보다 넓어지면 잘리는 대신 카메라를
// 줌아웃해서 다 보이게 한다 — 폭·높이를 함께 키워야 화면 비율이 안 틀어지고,
// centerX를 같이 넘겨서 줌아웃해도 원래 보던 지점이 그대로 중앙에 남는다.
function fitToWidth(centerX,neededW){
  const w=Math.max(VB_W0,neededW*1.12);
  targetVBW=w;
  targetVBH=w*(VB_H0/VB_W0);
  targetX=centerX-w*0.5;
}
function resetZoom(centerX){
  targetVBW=VB_W0;
  targetVBH=VB_H0;
  targetX=centerX-VB_W0*0.5;
}
// heroOverride가 켜져 있는 동안(박스 안에서 직접 움직일 때)은 데드존 추적을 끄고,
// 다른 코드가 이 요소를 직접 움직인다 — 화면에 존재하는 빛은 이 hero 하나뿐이라
// 새 점을 따로 만들지 않는다.
function startFollow(){
  if(followOn)return;
  followOn=true;
  function frame(){
    if(!heroOverride){
      const rel=heroWorldX-camX;
      if(rel>VB_W*DZ_R)targetX=heroWorldX-VB_W*DZ_R;
      else if(rel<VB_W*DZ_L)targetX=heroWorldX-VB_W*DZ_L;
    }
    camX+=(targetX-camX)*camRate;
    camY+=(targetY-camY)*camRate;
    VB_W+=(targetVBW-VB_W)*camRate;
    VB_H+=(targetVBH-VB_H)*camRate;
    el.svg.setAttribute('viewBox',`${camX} ${camY} ${VB_W} ${VB_H}`);
    if(heroEl&&!heroOverride)heroEl.setAttribute('cx',heroWorldX);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
// SVG는 그려진 순서(DOM 순서)대로 쌓인다 — hero는 항상 g보다 나중에(=화면 앞에)
// 있어서, 불투명한 박스 안으로 들어갈 때도 계속 박스 표면 위에 떠 있는 것처럼
// 보였다. 박스 경계를 넘는 순간에만 hero를 g보다 앞(=화면 뒤)으로 옮겨서 박스에
// 진짜로 가려지게 하고, 다시 나타나기 직전에 원래 자리(맨 앞)로 돌려놓는다.
function heroBehind(g){el.svg.insertBefore(heroEl,g)}
function heroFront(){el.svg.appendChild(heroEl)}

function world(totalLen){
  const d=n('defs'),f=n('filter',{id:'txGlow',x:'-100%',y:'-100%',width:'300%',height:'300%'});
  f.append(n('feGaussianBlur',{stdDeviation:'4',result:'b'}),n('feMerge'));
  f.lastChild.append(n('feMergeNode',{in:'b'}),n('feMergeNode',{in:'SourceGraphic'}));
  d.append(f);
  el.svg.replaceChildren(d);
  const g=n('g');
  el.svg.append(g);
  // 시작 지점(카메라 초기 좌우 여유, 나중에 줌아웃될 경우까지)보다 훨씬 왼쪽부터
  // 그어야 화면 왼쪽 끝에서 선이 끊겨 보이지 않는다.
  railY=430;
  g.append(line(-3000,railY,totalLen,railY,'txMainRail'));
  VB_W=targetVBW=VB_W0;
  VB_H=targetVBH=VB_H0;
  camRate=0.11;
  heroWorldX=230+140;
  camX=heroWorldX-VB_W*0.5;
  targetX=camX;
  camY=0;
  targetY=0;
  heroOverride=false;
  el.svg.setAttribute('viewBox',`${camX} ${camY} ${VB_W} ${VB_H}`);
  heroEl=dot(heroWorldX,railY,7,'txHero');
  el.svg.append(heroEl);
  startFollow();
  return g;
}
// 단계 제목/설명은 SVG 세계 좌표가 아니라 화면 왼쪽 위에 고정된 플로팅 위젯에
// 쓴다 — 그래야 카메라가 줌/팬 되어도 크기와 위치가 항상 그대로 유지된다.
function station(label,sub){
  el.stageTitle.textContent=label;
  el.stageSub.textContent=sub;
}
function visible(g){
  g.style.opacity=0;
  requestAnimationFrame(()=>{g.style.transition='opacity .4s';g.style.opacity=1});
}

// 입력 폼(HTML)에서 실제 1단계(SVG 문장)로 이어지는 도입부다. 새 엘리먼트로
// 바꿔치기하지 않는다 — tokenZone이 계속 쓸 바로 그 label/tspans를 여기서
// 디코이와 완전히 같은 크기(15px)로 만들어서 바꿔친 뒤, 같은 엘리먼트의
// font-size를 1단계 크기(25px)로 부드럽게 키운다(순간적으로 커지지 않는다).
// 그 다음 메인라인이 왼쪽에서 오른쪽으로 그려지듯 나타나고 → 제목/설명 →
// 처음으로 버튼 → 질문이 차례로 페이드인되면 1단계로 이어진다.
async function introZone(g,input,token){
  heroEl.classList.add('hidden');
  // 레일은 world()에서 이미 전체 길이로 그려져 있다 — 첫 프레임이 그려지기도
  // 전에(비동기로 넘어가기 전에) 바로 길이를 0으로 접어서, "다 그려진 선이
  // 잠깐 보였다가 지워지고 다시 그려지는" 현상이 생기지 않게 한다. 실제로
  // 늘어나는 모습은 뒤(메인라인 스윕)에서만 보여준다.
  const rail=g.querySelector('.txMainRail');
  let railX1,railX2;
  if(rail){
    railX1=rail.getAttribute('x1');
    railX2=rail.getAttribute('x2');
    rail.setAttribute('x2',railX1);
  }
  const X=230,anchorX=X+140;
  const sentence=input.join(' ');
  const chars=[...sentence];
  // y=300은 1단계 문장이 늘 있는 자리지만, 그게 화면의 정확히 어디에 찍히는지는
  // (헤더 여백, viewBox 비율에 따른 레터박스 등 때문에) 디코이가 있던 화면
  // 정중앙과 몇 픽셀 어긋날 수 있다 — 눈대중 보정이 아니라, 디코이가 실제로
  // 있던 화면 좌표를 SVG의 실제 변환행렬(getScreenCTM)로 정확히 역산해서 그
  // 자리에서 시작한 뒤, 1단계 자리(y=300)로 자연스럽게 옮겨간다.
  const decoyRect=el.decoy.getBoundingClientRect();
  const decoyCx=decoyRect.left+decoyRect.width/2,decoyCy=decoyRect.top+decoyRect.height/2;
  const camXStart=anchorX-VB_W0*0.5;
  el.svg.setAttribute('viewBox',`${camXStart} 0 ${VB_W0} ${VB_H0}`);
  const ctm=el.svg.getScreenCTM();
  const pt=el.svg.createSVGPoint();
  pt.x=decoyCx;pt.y=decoyCy;
  const startPt=ctm?pt.matrixTransform(ctm.inverse()):{x:anchorX,y:300};
  const label=t(anchorX,startPt.y,'','txBigToken');
  label.setAttribute('text-anchor','middle');
  // SVG 안의 "px"는 화면 실제 픽셀이 아니라 viewBox 배율을 타는 사용자 단위다 —
  // 디코이(진짜 15 CSS px)와 크기를 맞추려면, 지금 화면에 실제로 렌더링되는
  // 배율로 나눠서 "화면에서 15px로 보이는" 값을 역산해야 한다. viewBox 비율
  // (990:500)이 실제 svg 태그의 가로세로 비율과 다르면 preserveAspectRatio가
  // 레터박스를 넣는데, 그러면 실제 배율은 가로 폭 비율이 아니라 "가로/세로 중
  // 더 작게 맞춰지는 쪽"이다 — 폭만으로 계산하면 실제보다 큰 배율로 잘못
  // 계산돼서, 글자가 디코이보다 작게 나왔다가 자라는 것처럼 보였다.
  const svgRect=el.svg.getBoundingClientRect();
  const svgScale=Math.min(svgRect.width/VB_W,svgRect.height/VB_H);
  label.style.fontSize=(15/svgScale)+'px';
  g.append(label);
  const tspans=chars.map(ch=>{
    const ts=document.createElementNS(NS,'tspan');
    ts.textContent=ch;
    label.appendChild(ts);
    return ts;
  });
  // 디코이(HTML)와 라벨(SVG)은 "중심"의 기준점이 서로 다르다 — 디코이는 박스
  // 중심이지만 SVG 텍스트의 y는 베이스라인이라, 공식만으로 맞추면 1px 안팎의
  // 어긋남이 남을 수 있다. 공식을 더 정교히 다듬는 대신, 실제로 화면에 그려진
  // 두 요소의 진짜 바운딩박스 중심을 재서 그 차이만큼만 y를 보정한다 — 추측이
  // 아니라 측정값이라 오차가 남지 않는다.
  const labelRect=label.getBoundingClientRect();
  const labelCy=labelRect.top+labelRect.height/2;
  startPt.y+=(decoyCy-labelCy)/svgScale;
  label.setAttribute('y',startPt.y);
  // SVG 문장이 디코이와 같은 크기로 이미 화면에 그려진 바로 이 프레임에(따로
  // 기다리지 않고) 디코이를 치운다 — 하나가 사라지고 나서 다른 하나가 나타나는
  // 틈이 없다.
  el.decoy.classList.remove('show');
  if(token!==runId)return{label,tspans};

  // 확대: 새 엘리먼트로 바꾸지 않고, 같은 label의 font-size를 1단계 크기로
  // 부드럽게 키우면서, 동시에 디코이가 있던 자리(startPt.y)에서 1단계 문장의
  // 제자리(y=300)로 자연스럽게 옮겨간다 — 그래야 작은 어긋남도 그냥 튀어
  // 보이지 않고 하나의 움직임으로 이어진다.
  await wait(150);
  if(token!==runId)return{label,tspans};
  label.style.transition='font-size .6s cubic-bezier(.2,.8,.2,1)';
  label.style.fontSize='25px';
  await anim(600,e=>label.setAttribute('y',startPt.y+(300-startPt.y)*e),token);
  if(token!==runId)return{label,tspans};
  label.style.transition='none';

  // 문장이 화면보다 길면 잘리지 않게 카메라를 줌아웃한다.
  fitToWidth(anchorX,label.getBBox().width);
  await wait(400);
  if(token!==runId)return{label,tspans};

  // 메인라인이, 보이지 않는 왼쪽 저 끝에서부터 뽑혀 나오듯 오른쪽으로 쭉
  // 그려진다 — 시작점을 화면 왼쪽 바깥 한참 밖에 두고(화면 안에서는 아무것도
  // 없다가 갑자기 나타나는 게 아니라 계속 왼쪽에서부터 끌려 나오는 것처럼),
  // 끝나면 원래의 전체 길이로 되돌린다(화면 밖이라 그 변화는 보이지 않는다).
  if(rail){
    const startX=camX-1200,viewR=camX+VB_W+40;
    rail.setAttribute('x1',startX);
    rail.setAttribute('x2',startX);
    await new Promise(done=>{
      const start=performance.now();
      function step(now){
        if(token!==runId){done();return}
        const q=Math.min(1,(now-start)/900),e=1-Math.pow(1-q,3);
        rail.setAttribute('x2',startX+(viewR-startX)*e);
        if(q<1)requestAnimationFrame(step);else done();
      }
      requestAnimationFrame(step);
    });
    rail.setAttribute('x1',railX1);
    rail.setAttribute('x2',railX2);
  }
  if(token!==runId)return{label,tspans};

  // 제목/설명 -> 처음으로 버튼 -> 질문, 뚝뚝 튀어나오지 않고 차례로 페이드인된다.
  el.stageInfo.classList.remove('show');
  station('01 / TOKENIZATION (토큰화)','텍스트를 벡터화하여 숫자로 바꿉니다.');
  requestAnimationFrame(()=>el.stageInfo.classList.add('show'));
  await wait(260);
  if(token!==runId)return{label,tspans};
  el.reset.classList.add('show');
  await wait(220);
  if(token!==runId)return{label,tspans};
  el.source.textContent='question: '+input.join('  ')+'  ';
  el.source.classList.remove('show');
  requestAnimationFrame(()=>el.source.classList.add('show'));
  await wait(350);
  return{label,tspans};
}

// 7단계로 정확히 진행한다: ① 문장이 그대로 보인다 ② 앞 글자부터 순서대로(단어 구분
// 없이) 숫자로 바뀐다(지금 바뀌는 글자엔 반전 강조 박스) ③ 전체가 이어진 숫자 하나로
// 완성된다 ④ 글자 하나하나가 구분선으로 나뉜다 ⑤ 구분선이 콤마로 정리된다
// ⑥ 단어 기준으로 나뉜 2차원 배열이 된다 ⑦ 그 배열 속 두 1차원 배열이 각자 동시에
// 메인선의 제자리로 이동하며 빛이 된다. ①(문장이 그대로 보이는 것)은 introZone이
// 이미 보여줬으므로, label/tspans를 그대로 이어받아 ②부터 시작한다.
async function tokenZone(g,input,token,label,tspans){
  const X=230,anchorX=X+140;
  const sentence=input.join(' ');
  const chars=[...sentence];
  const codes=chars.map(c=>c.codePointAt(0));
  let wi=0;
  const wordIdx=chars.map(c=>{if(c===' '){wi++;return -1}return wi});

  // ② 앞 글자부터 순서대로(단어 구분 없이) 두 글자씩 묶어 숫자로 바뀐다(전체 글자수가
  // 홀수면 마지막 묶음만 한 글자) — 지금 바뀌는 묶음엔 반전된 강조 박스가 따라붙는다.
  // cursor는 글자보다 먼저(=화면 뒤에) 있어야 글자가 그 위에 반전된 색으로
  // 보인다 — 뒤에 붙이면(g.append) label보다 나중이라 오히려 글자를 덮어버린다.
  const cursor=n('rect',{y:281,height:32,rx:2,class:'txCursor'});
  g.insertBefore(cursor,label);
  const tokenizerLabel=t(anchorX,255,'TOKENIZER','txId');
  tokenizerLabel.style.opacity=0;
  g.append(tokenizerLabel);
  requestAnimationFrame(()=>{tokenizerLabel.style.transition='opacity .5s';tokenizerLabel.style.opacity=1});
  for(let i=0;i<chars.length;i+=2){
    if(token!==runId)return anchorX;
    const j=Math.min(i+1,chars.length-1);
    const bbA=tspans[i].getBBox(),bbB=tspans[j].getBBox();
    const left=Math.min(bbA.x,bbB.x),right=Math.max(bbA.x+bbA.width,bbB.x+bbB.width);
    cursor.setAttribute('x',left-2);
    cursor.setAttribute('width',right-left+4);
    cursor.setAttribute('opacity',1);
    tspans[i].classList.add('txCursorChar');
    if(j!==i)tspans[j].classList.add('txCursorChar');
    await wait(150);
    if(token!==runId)return anchorX;
    tspans[i].textContent=String(codes[i]);
    tspans[i].classList.remove('txCursorChar');
    if(j!==i){
      tspans[j].textContent=String(codes[j]);
      tspans[j].classList.remove('txCursorChar');
    }
    const bbA2=tspans[i].getBBox(),bbB2=tspans[j].getBBox();
    const left2=Math.min(bbA2.x,bbB2.x),right2=Math.max(bbA2.x+bbA2.width,bbB2.x+bbB2.width);
    cursor.setAttribute('x',left2-2);
    cursor.setAttribute('width',right2-left2+4);
    // 글자가 숫자로 바뀔수록 전체 폭이 늘어나므로, 매 묶음마다 다시 확인해서
    // 화면 밖으로 나가면 그만큼 더 줌아웃한다.
    fitToWidth(anchorX,label.getBBox().width);
    await wait(110);
  }
  cursor.setAttribute('opacity',0);
  if(token!==runId)return anchorX;
  await wait(300);

  // ③ 이제 하나로 이어진 숫자 문자열이 완성됐다 — 개별 글자 요소로 나눠서(단어 구분
  // 표식은 유지) 다음 단계(구분선 -> 콤마 -> 배열)로 넘어간다.
  const finalPos=tspans.map(ts=>{const bb=ts.getBBox();return{x:bb.x+bb.width/2,w:bb.width}});
  label.remove();
  const items=chars.map((ch,i)=>({wi:wordIdx[i],seg:String(codes[i]),x:finalPos[i].x,w:finalPos[i].w,el:null}));
  items.forEach(it=>{
    const e=t(it.x,300,it.seg,'txBigToken');
    e.setAttribute('text-anchor','middle');
    g.append(e);
    it.el=e;
  });
  // 한 덩어리 문장이 개별 글자로 나뉘어도 전체 폭은 그대로다(오히려 ⑤~⑥에서 콤마·
  // 괄호가 붙어 더 넓어진다) — 여기서 배율을 원래대로 돌리면 안 된다. 계속 실제
  // 폭을 재서 필요한 만큼 줌아웃을 유지한다.
  fitToWidth(anchorX,Math.max(...items.map(it=>it.x+it.w/2))-Math.min(...items.map(it=>it.x-it.w/2)));
  await wait(250);
  if(token!==runId)return anchorX;

  // ④ 글자 하나하나가 구분선으로 나뉜다.
  const dividers=[];
  for(let i=0;i<items.length-1;i++){
    const mx=(items[i].x+items[i].w/2+items[i+1].x-items[i+1].w/2)/2;
    const dv=n('line',{x1:mx,y1:284,x2:mx,y2:316,class:'txDivider'});
    dv.style.opacity=0;
    g.append(dv);
    dividers.push(dv);
  }
  await wait(20);
  dividers.forEach(dv=>{dv.style.transition='opacity .25s';dv.style.opacity=1});
  await wait(340);
  if(token!==runId)return anchorX;

  // ⑤ 구분선이 사라지고, 콤마가 끼어들면서 숫자들이 서로 옆으로 자연스럽게 밀려나며
  // 벌어진다. 콤마가 붙은 뒤의 실제 렌더링 폭(getComputedTextLength)으로 목표 위치를
  // 계산해서 밀어내므로 — 폭을 따로 추정하지 않아서 겹치거나 뜨지 않는다.
  dividers.forEach(dv=>dv.remove());
  items.forEach(it=>{it.el.style.textAnchor='start';it.el.setAttribute('x',it.x-it.w/2)});
  items.forEach((it,i)=>{it.el.textContent=it.seg+(i<items.length-1?', ':'')});
  const flatW=items.map(it=>it.el.getComputedTextLength());
  const flatTotal=flatW.reduce((a,b)=>a+b,0);
  let fx=anchorX-flatTotal/2;
  const flatX0=items.map((it,i)=>{const x0=fx;fx+=flatW[i];return x0});
  // 콤마가 끼어들며 전체 폭이 늘어난 만큼 줌아웃을 다시 맞춘다(밀려나는 동안 카메라도
  // 같이 넓어지도록 애니메이션을 시작하는 시점에 바로 반영한다).
  fitToWidth(anchorX,flatTotal);
  await Promise.all(items.map((it,i)=>new Promise(done=>{
    const start=performance.now(),x0=it.x-it.w/2,target=flatX0[i];
    function go(now){
      if(token!==runId){done();return}
      const q=Math.min(1,(now-start)/420),e=1-Math.pow(1-q,3);
      it.el.setAttribute('x',x0+(target-x0)*e);
      q<1?requestAnimationFrame(go):done();
    }
    requestAnimationFrame(go);
  })));
  if(token!==runId)return anchorX;
  await wait(480);

  // ⑥ 공백이 사라지고, 단어 기준으로 나뉜 2차원 배열이 된다 — 기존 숫자들을 없앴다가
  // 새로 그리는 게 아니라, 그 숫자들 사이사이에 괄호/콤마를 끼워 넣고 숫자들은 그
  // 새 자리로 자연스럽게 밀려나게(다시 실측 폭 기반으로) 한다.
  const spaceItems=items.filter(it=>it.wi===-1),charItems=items.filter(it=>it.wi!==-1);
  spaceItems.forEach(it=>{it.el.style.transition='opacity .25s';it.el.style.opacity=0});
  await wait(250);
  spaceItems.forEach(it=>it.el.remove());
  charItems.forEach(it=>{it.el.textContent=it.seg});

  const wordGroups=input.map((_,w)=>charItems.filter(it=>it.wi===w));
  const slots=[{kind:'bracket',text:'[',outer:true}];
  wordGroups.forEach((mem,wi2)=>{
    slots.push({kind:'bracket',text:'[',wordOpen:true,wi:wi2});
    mem.forEach((it,ci)=>{
      slots.push({kind:'digit',item:it,wi:wi2});
      if(ci<mem.length-1)slots.push({kind:'comma',text:',',wi:wi2});
    });
    slots.push({kind:'bracket',text:']',wordClose:true,wi:wi2});
    if(wi2<wordGroups.length-1)slots.push({kind:'comma',text:',',outer:true});
  });
  slots.push({kind:'bracket',text:']',outer:true});
  slots.forEach(s=>{
    if(s.kind==='digit')s.el=s.item.el;
    else{s.el=t(0,300,s.text,s.kind==='bracket'?'txBracket':'txArrayMid');s.el.style.opacity=0;g.append(s.el)}
  });
  const slotW=slots.map(s=>s.el.getComputedTextLength());
  const slotTotal=slotW.reduce((a,b)=>a+b,0);
  let sx=anchorX-slotTotal/2;
  const slotX0=slots.map((s,i)=>{const x0=sx;sx+=slotW[i];return x0});
  // 괄호·콤마가 더 붙어서 지금까지 중 가장 넓은 상태다 — 그만큼 다시 줌아웃한다.
  fitToWidth(anchorX,slotTotal);
  slots.forEach((s,i)=>{if(s.kind!=='digit')s.el.setAttribute('x',slotX0[i])});
  await Promise.all(slots.map((s,i)=>{
    if(s.kind!=='digit')return;
    return new Promise(done=>{
      const start=performance.now(),x0=+s.el.getAttribute('x'),target=slotX0[i];
      function go(now){
        if(token!==runId){done();return}
        const q=Math.min(1,(now-start)/420),e=1-Math.pow(1-q,3);
        s.el.setAttribute('x',x0+(target-x0)*e);
        q<1?requestAnimationFrame(go):done();
      }
      requestAnimationFrame(go);
    });
  }));
  if(token!==runId)return anchorX;
  slots.filter(s=>s.kind!=='digit').forEach(s=>{s.el.style.transition='opacity .3s';s.el.style.opacity=1});
  await wait(400);
  if(token!==runId)return anchorX;

  // ⑦ 바깥 2차원 배열의 대괄호(와 그 사이 콤마)는 점점 사라지고, 1차원 배열은
  // 각자(동시에) 제 괄호가 양쪽에서 가운데로 모여 하나가 된다. 하나가 된 그 자리에서
  // 빛이 되어, 옆으로 가지 않고 수직으로 곧장 메인선까지 내려간다.
  // 여기서부터는 폭이 계속 좁아지기만 하므로(괄호가 모이고 내용이 사라짐) 원래
  // 배율로 되돌리기 시작한다 — 수렴 애니메이션이 진행되는 동안 자연스럽게 줌인된다.
  resetZoom(anchorX);
  const outerOpenEl=slots[0].el,outerCloseEl=slots[slots.length-1].el;
  const outerEls=slots.filter(s=>s.outer).map(s=>s.el);
  // 2차원 배열의 양쪽 끝 대괄호는 제자리에서 페이드하지 않는다 — 첫 단어는 자기
  // 왼쪽 대괄호 대신 이 바깥 왼쪽 대괄호와 짝을 이뤄 압축되고, 마지막 단어는 바깥
  // 오른쪽 대괄호와 짝을 이룬다(아래 wordArrs에서 처리). 그 사이 바깥 콤마들만
  // 여기서 그대로 페이드아웃한다.
  outerEls.filter(e=>e!==outerOpenEl&&e!==outerCloseEl).forEach(e=>{e.style.transition='opacity .8s';e.style.opacity=0});
  const wordArrs=wordGroups.map((mem,wi2)=>{
    const isFirst=wi2===0,isLast=wi2===wordGroups.length-1;
    const ownOpenEl=slots.find(s=>s.wordOpen&&s.wi===wi2).el,ownCloseEl=slots.find(s=>s.wordClose&&s.wi===wi2).el;
    let openEl=ownOpenEl,closeEl=ownCloseEl;
    // 맨 왼쪽 1차원 배열: 자기 왼쪽 대괄호 대신 2차원 배열의 왼쪽 대괄호와 압축되고,
    // 자기 왼쪽 대괄호는 압축이 시작되는 순간 그냥 자연스럽게 사라진다.
    if(isFirst){
      openEl=outerOpenEl;
      ownOpenEl.style.transition='opacity .3s';ownOpenEl.style.opacity=0;
      setTimeout(()=>ownOpenEl.remove(),300);
    }
    // 맨 오른쪽 1차원 배열은 그 반대다.
    if(isLast){
      closeEl=outerCloseEl;
      ownCloseEl.style.transition='opacity .3s';ownCloseEl.style.opacity=0;
      setTimeout(()=>ownCloseEl.remove(),300);
    }
    const center=(+openEl.getAttribute('x')+ +closeEl.getAttribute('x'))/2;
    // 숫자·콤마는 제자리에서 움직이거나 작아지지 않는다 — 대신 문 두 짝(괄호)이
    // 불투명하게 양쪽에서 닫혀오면서, 그 사이(열린 틈)만 보이게 클립을 씌운다.
    // 틈이 좁아질수록 바깥쪽 숫자부터 차례로 가려지다가, 문이 완전히 닫히면(틈
    // 폭이 0이 되면) 안이 통째로 안 보이게 된다.
    const innerEls=slots.filter(s=>s.wi===wi2&&!s.wordOpen&&!s.wordClose).map(s=>s.el);
    const clipRect=n('rect',{x:0,y:270,width:0,height:60});
    const clipPath=n('clipPath',{id:`tkClip${wi2}`});
    clipPath.append(clipRect);
    const innerGroup=n('g',{'clip-path':`url(#tkClip${wi2})`});
    innerEls.forEach(el=>innerGroup.append(el));
    g.append(clipPath,innerGroup);
    return{openEl,closeEl,clipRect,clipPath,innerGroup,center,wi:wi2};
  });
  const landingX=await Promise.all(wordArrs.map(w=>new Promise(done=>{
    const start=performance.now(),oX0=+w.openEl.getAttribute('x'),cX0=+w.closeEl.getAttribute('x'),target=w.center;
    function go(now){
      if(token!==runId){done(target);return}
      const q=Math.min(1,(now-start)/460),e=1-Math.pow(1-q,3);
      const oX=oX0+(target-oX0)*e,cX=cX0+(target-cX0)*e;
      w.openEl.setAttribute('x',oX);
      w.closeEl.setAttribute('x',cX);
      w.clipRect.setAttribute('x',Math.min(oX,cX));
      w.clipRect.setAttribute('width',Math.max(0,Math.abs(cX-oX)));
      if(q<1)requestAnimationFrame(go);
      else{w.openEl.remove();w.closeEl.remove();w.clipPath.remove();w.innerGroup.remove();done(target)}
    }
    requestAnimationFrame(go);
  })));
  if(token!==runId)return anchorX;

  // 각 단어의 빛이 메인라인까지 내려온다.
  const orbs=landingX.map(x=>{const o=dot(x,300,7,'txArrayLight');g.append(o);return o});
  await Promise.all(orbs.map(orb=>new Promise(done=>{
    const start=performance.now();
    function go(now){
      if(token!==runId){done();return}
      const q=Math.min(1,(now-start)/380),e=1-Math.pow(1-q,3);
      orb.setAttribute('cy',300+(430-300)*e);
      if(q<1)requestAnimationFrame(go);else done();
    }
    requestAnimationFrame(go);
  })));
  outerEls.forEach(e=>e.remove());
  if(token!==runId){orbs.forEach(o=>o.remove());return anchorX}
  await wait(90);

  // 내려온 여러 개의 빛이 사라졌다가 새 빛이 생기는 게 아니라, 그 빛들이 한 점으로
  // 모여 뭉쳐서 그대로 주인공(hero)이 된다 — 지금까지 숨어 있던 hero를 바로 이
  // 자리에서 이어받으므로 화면에는 항상 빛이 하나뿐이다.
  const mergeX=(Math.min(...landingX)+Math.max(...landingX))/2;
  await Promise.all(orbs.map((orb,idx)=>new Promise(done=>{
    const start=performance.now(),x0=landingX[idx];
    function go(now){
      if(token!==runId){done();return}
      const q=Math.min(1,(now-start)/300),e=1-Math.pow(1-q,3);
      orb.setAttribute('cx',x0+(mergeX-x0)*e);
      if(q<1)requestAnimationFrame(go);else done();
    }
    requestAnimationFrame(go);
  })));
  orbs.forEach(o=>o.remove());
  if(token!==runId)return anchorX;
  // heroWorldX만 바꾸면 다음 follow 루프 프레임이 돌 때까지(최대 한 프레임) hero가
  // 예전 위치(anchorX 근처)에 그대로 남아있다가 순간 이동하는 것처럼 보일 수 있다 —
  // 드러나는 것과 같은 프레임에 실제 좌표도 직접 맞춰서 그 틈을 없앤다.
  heroWorldX=mergeX;
  heroEl.setAttribute('cx',mergeX);
  heroEl.setAttribute('cy',430);
  heroEl.classList.remove('hidden');
  await wait(220);
  return mergeX+250;
}

// 메인라인이 중간에 아래로 꺾여 내려가 거대한 박스로 이어진다 — 빛이 그 안으로
// 들어가 사라지면 화면이 점점 축소되며 박스 전체가 드러나고(다른 거대 박스와
// 같은 문법 — finaleZone 참고), 그 안에 단어 점들이 하나씩 반짝이며 나타난다.
// 장식이 아니라 실제 모델의 임베딩 레이어에서 뽑아 PCA로 2차원에 투영한 진짜
// 좌표다(backend/generate.py의 compute_embedding_view) — 고정 기준 단어는
// 흰색, 이번에 입력한 문장의 단어는 민트색으로 구분한다.
async function embeddingZone(g,startX,data,token){
  const X=startX+300;
  station('02 / EMBEDDING FIELD (임베딩)','토큰 하나를 768차원 벡터로 변환해 각 단어간의 관계성을 계산합니다');

  // 아래로 내려가는 선을 훨씬 길게 두어(레일에서 한참 떨어진 곳) 거대한 박스로
  // 내려가는 느낌을 준다.
  const bendX=X+60,boxW=1500,boxH=760,boxTop=1050,boxBottom=boxTop+boxH,boxX=bendX;
  const exitX=boxX,newRailY=boxBottom+60;

  // 메인라인 1은 오른쪽으로 끝없이 이어지지 않고 여기서 끊는다(ㄱ자 — 가로로
  // 오다가 이 지점에서 세로로 꺾여 내려간다). 박스 아래로 이어지는 메인라인
  // 2(ㄴ자)는 나중에 빛이 나갈 때 갑자기 생기지 않도록 처음부터 다 만들어
  // 둔다 — 카메라가 비추기 전까지는 그냥 화면 밖에 미리 있는 것뿐이다.
  const rail1=g.querySelector('.txMainRail');
  const railTailX=rail1?rail1.getAttribute('x2'):bendX+20000;
  if(rail1)rail1.setAttribute('x2',bendX);
  g.append(
    line(bendX,430,bendX,boxTop,'txGuide'),
    line(exitX,boxBottom,exitX,newRailY,'txGuide'),
    line(exitX,newRailY,railTailX,newRailY,'txMainRail')
  );
  railY=newRailY;

  const boxGroup=n('g');
  boxGroup.style.opacity=0;
  const box=n('rect',{x:boxX-boxW/2,y:boxTop,width:boxW,height:boxH,rx:18,class:'txCandBox'});
  const embedLabel=t(boxX-boxW/2+24,boxTop-14,'EMBEDDING MODEL','txId');
  // .txId 클래스가 CSS로 text-anchor:middle을 이미 정하고 있어서, 속성으로
  // setAttribute('text-anchor',...)를 줘도 스타일시트가 우선이라 무시된다 —
  // 인라인 style로 줘야 실제로 왼쪽 정렬된다.
  embedLabel.style.textAnchor='start';
  boxGroup.append(box,embedLabel);
  // 산점도처럼 보이게 안에 좌표 그리드를 쳐준다 — 장식이지만, 점들이 실제
  // 좌표 공간 위에 찍히는 느낌을 준다.
  const gridCols=10,gridRows=6;
  for(let i=1;i<gridCols;i++){
    const gx=boxX-boxW/2+(boxW/gridCols)*i;
    boxGroup.append(line(gx,boxTop,gx,boxBottom,'txEmbedGrid'));
  }
  for(let i=1;i<gridRows;i++){
    const gy=boxTop+(boxH/gridRows)*i;
    boxGroup.append(line(boxX-boxW/2,gy,boxX+boxW/2,gy,'txEmbedGrid'));
  }
  g.append(boxGroup);
  requestAnimationFrame(()=>{boxGroup.style.transition='opacity .8s';boxGroup.style.opacity=1});

  // 레일을 타고 꺾이는 지점까지 온 뒤, 다른 박스들과 같은 문법으로 — 이번엔
  // 위가 아니라 아래로, 더 오랫동안 — 곧장 내려가 박스 안으로 사라진다. 카메라
  // 축소도 이 하강과 동시에 시작한다 — 초점은 박스 한가운데라, 줌아웃이 끝나면
  // 관람객이 집중할 수 있게 박스 전체가 화면 중앙에 놓인다.
  await centerOn(bendX,token);
  if(token!==runId)return boxX+boxW/2+250;
  heroEl.setAttribute('cx',bendX);
  heroOverride=true;
  const boxCenterY=(boxTop+boxBottom)/2;
  // 줌아웃 폭을 너무 넉넉히 잡으면 안의 단어·점이 작아 보인다 — 박스가 화면
  // 거의 꽉 차게 확대해서 안을 자세히 볼 수 있게 한다.
  const zoomH=boxH+120,zoomW=zoomH*(VB_W0/VB_H0);
  camRate=0.045;
  targetX=boxX-zoomW*0.5;
  // #traceSvg는 뷰포트 전체 높이를 덮지 않는다(아래쪽에 여백) — 카메라만으로
  // 박스를 SVG 안에서 중앙에 맞춰도, 화면(뷰포트) 전체 기준으로는 위로 치우쳐
  // 보인다. SVG 사각형의 실제 중심이 화면 진짜 중앙에서 얼마나 떨어져 있는지
  // 직접 재서(추측 대신 실측값으로) 그만큼 보정한다.
  const svgRect=el.svg.getBoundingClientRect();
  const svgScale2=Math.min(svgRect.width/zoomW,svgRect.height/zoomH);
  const viewportCenterGap=(window.innerHeight/2)-(svgRect.top+svgRect.height/2);
  const finalTargetY=boxCenterY-zoomH*0.5-viewportCenterGap/svgScale2;
  targetVBW=zoomW;
  targetVBH=zoomH;
  // 박스 경계를 넘어 안으로 사라지는 순간부터는 hero를 박스(g)보다 뒤로 보내
  // 불투명한 박스 표면에 진짜로 가려지게 한다.
  heroBehind(g);
  // targetY를 최종값으로 한 번에 고정해두면, 카메라(camRate=0.045, 느린 시네마틱
  // 줌)가 그 목표를 따라가는 속도가 빛이 실제로 내려가는 1.5초보다 느려서 빛이
  // 화면 밖으로 나가버린 채(안 보이는 채로) 혼자 쑥 내려가 버린다 — 그래서
  // 매 프레임 "지금 빛의 위치를 따라가는 값"에서 "최종 박스 프레이밍"으로
  // 진행도(e)에 맞춰 서서히 넘어가도록 targetY를 직접 갱신하며 하강시킨다.
  await anim(1500,e=>{
    const curY=430+(boxTop-430)*e;
    heroEl.setAttribute('cy',curY);
    const followY=curY-VB_H*0.5;
    targetY=followY+(finalTargetY-followY)*e;
  },token);
  if(token!==runId){heroOverride=false;heroFront();return boxX+boxW/2+250}
  heroEl.classList.add('hidden');
  await wait(700);
  if(token!==runId)return boxX+boxW/2+250;

  // 박스 안에 단어 점들이 하나씩 번쩍이며 나타난다 — 순간 확 커졌다가(번쩍) 제
  // 크기로 가라앉는다. 고정 기준 단어(흰색)가 다 나온 뒤 1.5초 쉬었다가, 이번
  // 문장의 단어(민트색, 점·글자 다 2배 크게)가 이어서 찍힌다. 점 수가 많아진
  // 만큼(300여개) 점멸 속도를 5배가량 빠르게 해서 전체를 훑는 시간은 비슷하게
  // 유지한다.
  const pad=140;
  const toScreen=(nx,ny)=>({x:boxX-boxW/2+pad+(nx+1)/2*(boxW-pad*2),y:boxTop+pad+(ny+1)/2*(boxH-pad*2)});
  const refWords=((data.embedding&&data.embedding.words)||[]).map(w=>({...w,mine:false}));
  const myWords=((data.embedding&&data.embedding.myWords)||[]).map(w=>({...w,mine:true}));
  el.metric.textContent='EMBEDDING FIELD';
  const placed=[];
  const placePoint=pt=>{
    const{x,y}=toScreen(pt.x,pt.y);
    const finalR=pt.mine?4.4:2.7,restFill=pt.mine?'#ff0000':'rgba(255,255,255,.55)';
    const flash=dot(x,y,finalR,pt.mine?'txEmbedDotMine':'txEmbedDot');
    flash.style.fill='#fff';
    g.append(flash);
    const label=t(x,y-(pt.mine?22:16),pt.text,pt.mine?'txEmbedWordMine':'txEmbedWord');
    label.style.opacity=0;
    g.append(label);
    // 점 하나하나의 1초짜리 점멸->사그라듦은 각자 독립적으로 흘러가게 두고(기다리지
    // 않음), 다음 점이 찍히는 속도는 아래 wait(15)로 빠르게 유지한다.
    requestAnimationFrame(()=>{
      label.style.transition='opacity .3s';
      label.style.opacity=1;
      flash.style.transition='fill 1s ease';
      flash.style.fill=restFill;
    });
    placed.push({pt,x,y,flash,label});
  };
  for(const pt of refWords){
    if(token!==runId)return boxX+boxW/2+250;
    placePoint(pt);
    await wait(15);
  }
  await wait(1500);
  if(token!==runId)return boxX+boxW/2+250;
  for(const pt of myWords){
    if(token!==runId)return boxX+boxW/2+250;
    placePoint(pt);
    await wait(15);
  }
  await wait(2000);
  if(token!==runId)return boxX+boxW/2+250;

  // 모든 글자(단어 라벨)가 서서히 사라진다.
  placed.forEach(p=>{p.label.style.transition='opacity .6s ease';p.label.style.opacity=0});
  await wait(650);
  if(token!==runId)return boxX+boxW/2+250;
  placed.forEach(p=>p.label.remove());

  // 점 하나하나가 순서대로(아주 빠르게) 숫자로 바뀐다 — 아무 숫자가 아니라, 그
  // 단어가 이번 질문 단어들의 평균 위치(무게중심)에서 얼마나 가까운지를 나타내는
  // 유사도(%)다.
  const mineCx=myWords.reduce((s,w)=>s+w.x,0)/Math.max(myWords.length,1);
  const mineCy=myWords.reduce((s,w)=>s+w.y,0)/Math.max(myWords.length,1);
  const maxDist=Math.SQRT2*2;
  for(const p of placed){
    if(token!==runId)return boxX+boxW/2+250;
    const d=Math.hypot(p.pt.x-mineCx,p.pt.y-mineCy);
    const sim=Math.max(0,Math.min(99,Math.round((1-d/maxDist)*100)));
    p.flash.style.transition='opacity .15s ease';
    p.flash.style.opacity=0;
    p.numEl=t(p.x,p.y+4,String(sim),p.pt.mine?'txEmbedNumMine':'txEmbedNum');
    p.numEl.setAttribute('text-anchor','middle');
    g.append(p.numEl);
    await wait(4);
  }
  if(token!==runId)return boxX+boxW/2+250;
  placed.forEach(p=>p.flash.remove());
  await wait(150);
  if(token!==runId)return boxX+boxW/2+250;

  // 박스 아래 출발선이 시작되는 지점(빛이 생겨날 자리)에 미리 작은 빛을 켜두고,
  // 그 빛에 가까운 숫자부터 자석처럼 촥촥 순서대로 달라붙는다 — 소용돌이가 아니라
  // 직선으로 빠르게 날아가 붙는다. 모두 달라붙은 뒤에야 그 자리에서 빛이 출발한다.
  const vortexX=exitX,vortexY=boxBottom;
  const vortexLight=dot(vortexX,vortexY,3,'txArrayLight');
  g.append(vortexLight);
  requestAnimationFrame(()=>{vortexLight.style.transition='r .3s ease';vortexLight.setAttribute('r',7)});
  // 거리순으로 너무 딱딱 맞게 규칙적으로 보이지 않도록, 정렬된 순번에 ±3 정도의
  // 무작위 오차를 더해 다시 정렬한다 — 대체로 가까운 순서를 따르되 바로 다음
  // 순번이 아니라 두세 칸 뒤의 것이 먼저 붙기도 한다.
  const order=placed.slice().sort((a,b)=>{
    const da=Math.hypot(a.x-vortexX,a.y-vortexY),db=Math.hypot(b.x-vortexX,b.y-vortexY);
    return da-db;
  }).map((p,idx)=>({p,key:idx+(Math.random()*6-3)})).sort((a,b)=>a.key-b.key).map(o=>o.p);
  const stagger=5,flightDur=140;
  await new Promise(done=>{
    const start=performance.now();
    function step(now){
      if(token!==runId){done();return}
      const elapsed=now-start;
      let allDone=true;
      order.forEach((p,idx)=>{
        const t0=idx*stagger,lt0=(elapsed-t0)/flightDur;
        if(lt0<0){allDone=false;return}
        const lt=Math.min(1,lt0);
        if(lt<1)allDone=false;
        const e=lt*lt*(3-2*lt);
        p.numEl.setAttribute('x',p.x+(vortexX-p.x)*e);
        p.numEl.setAttribute('y',p.y+4+(vortexY-(p.y+4))*e);
        p.numEl.style.opacity=1-e;
      });
      if(!allDone)requestAnimationFrame(step);else done();
    }
    requestAnimationFrame(step);
  });
  placed.forEach(p=>p.numEl.remove());
  if(token!==runId){vortexLight.remove();return boxX+boxW/2+250}

  // 다 달라붙은 그 자리에서 곧장 빛이 출발한다 — 같은 프레임에 넘겨받으므로
  // vortexLight가 사라지고 hero가 나타나는 틈이 없다. 박스 아래쪽에서 ㄴ자
  // 모양(아래로 살짝, 그 다음 오른쪽)으로 내려가 미리 만들어둔 메인라인 2를
  // 타고 나간다. 다시 보여야 하니 hero를 원래 자리(맨 앞)로 돌려놓는다.
  vortexLight.remove();
  heroFront();
  heroEl.setAttribute('cx',exitX);
  heroEl.setAttribute('cy',boxBottom);
  heroEl.classList.remove('hidden');
  await anim(450,e=>heroEl.setAttribute('cy',boxBottom+(newRailY-boxBottom)*e),token);
  heroWorldX=exitX;
  heroOverride=false;
  if(token!==runId)return exitX+250;

  // 카메라를 원래 배율로 되돌리는 동시에, 임베딩 박스와 3단계 박스가 겹치지
  // 않도록 충분히 오른쪽으로 더 이동한다(박스 폭 1500을 확실히 벗어날 만큼).
  // 세로 기준점은 레일 자체가 아니라, 앞으로 나올 후보 박스들의 한가운데다 —
  // 그래야 그 박스(와 선)가 화면 위쪽으로 치우치지 않고 잘 보이는 자리에 놓인다
  // (후보 박스는 레일 위 230만큼, 레일에서 30 띄워 놓인다 — decodeZone과 같은 수치).
  camRate=0.11;
  targetVBW=VB_W0;
  targetVBH=VB_H0;
  targetY=(railY-30-115)-VB_H0*0.5;
  const clearX=exitX+1000;
  await centerOn(clearX,token);
  return clearX+250;
}

// 임베딩이 곧장 다음 토큰 후보로 점프하지 않는다 — 실제로는 24개 트랜스포머
// 레이어를 하나씩 통과하며, 레이어마다 셀프어텐션과 FFN이 차례로 값을 다듬는다.
// 레일을 그대로 감싸는 큰 박스 하나 안에 어텐션 구역(흰 막대)과 FFN 구역(주황
// 막대)이 나란히 있다: ①진입(굵은 빛 하나) ②어텐션 구간에서 레이어 수만큼
// 가는 빛 가닥으로 갈라져 각자 막대를 채운다(막대는 실제 셀프어텐션 출력
// 크기) ③잠깐 하나로 합류 ④FFN 구간에서 다시 갈라져 주황 막대를 채운다(실제
// FFN 출력 크기) ⑤다시 하나로 합쳐져 다음 단계로 직진.
function growBarUp(bar,targetH,baseline){
  const start=performance.now(),dur=280;
  function step(now){
    const q=Math.min(1,(now-start)/dur),e=1-Math.pow(1-q,3),h=targetH*e;
    bar.setAttribute('height',h);
    bar.setAttribute('y',baseline-h);
    if(q<1)requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
// 빛 한 줄기가 items 개수만큼 갈라져(from에서) 각자의 자리로 흩어져 막대를
// 채운 뒤, 다시 mergeTo 한 점으로 모여 합쳐진다. 마지막 하나(합쳐진 빛)는
// 지우지 않고 반환한다 — 호출한 쪽이 다음 구간의 시작점으로 이어 쓰거나,
// 다 끝났으면 직접 지운다.
async function forkFillMerge(g,token,{from,items,baseline,mergeTo}){
  const orbs=items.map(()=>{const o=dot(from.x,from.y,3,'txArrayLight');g.append(o);return o});
  const speed=0.35;
  await Promise.all(orbs.map((o,i)=>new Promise(done=>{
    const it=items[i],x0=from.x,y0=from.y,x1=it.x,y1=baseline;
    const dur=Math.max(180,Math.hypot(x1-x0,y1-y0)/speed),start=performance.now();
    let landed=false;
    function step(now){
      if(token!==runId){done();return}
      const q=Math.min(1,(now-start)/dur),e=1-Math.pow(1-q,3);
      o.setAttribute('cx',x0+(x1-x0)*e);
      o.setAttribute('cy',y0+(y1-y0)*e);
      if(!landed&&q>=1){
        landed=true;
        growBarUp(it.bar,it.h,baseline);
        if(it.valLabel){it.valLabel.style.transition='opacity .3s';it.valLabel.style.opacity=1}
      }
      if(q<1)requestAnimationFrame(step);else done();
    }
    requestAnimationFrame(step);
  })));
  if(token!==runId){orbs.forEach(o=>o.remove());return null}
  await wait(150);
  if(token!==runId){orbs.forEach(o=>o.remove());return null}
  await Promise.all(orbs.map(o=>new Promise(done=>{
    const x0=+o.getAttribute('cx'),y0=+o.getAttribute('cy');
    const dur=Math.max(150,Math.hypot(mergeTo.x-x0,mergeTo.y-y0)/0.45),start=performance.now();
    function step(now){
      if(token!==runId){done();return}
      const q=Math.min(1,(now-start)/dur),e=1-Math.pow(1-q,3);
      o.setAttribute('cx',x0+(mergeTo.x-x0)*e);
      o.setAttribute('cy',y0+(mergeTo.y-y0)*e);
      if(q<1)requestAnimationFrame(step);else done();
    }
    requestAnimationFrame(step);
  })));
  if(token!==runId){orbs.forEach(o=>o.remove());return null}
  orbs.slice(1).forEach(o=>o.remove());
  return orbs[0]||null;
}
async function transformerZone(g,startX,data,token){
  const X=startX+260;
  const layers=(data.layers&&data.layers.layers)||[];
  const numLayers=(data.layers&&data.layers.num_layers)||layers.length||24;
  station('03 / TRANSFORMER LAYERS (레이어 스택)',`임베딩이 ${numLayers}개 레이어를 통과하며, 레이어마다 셀프어텐션과 FFN이 차례로 값을 다듬습니다.`);
  if(!layers.length)return X;

  const barW=30,barGap=10,zoneW=numLayers*(barW+barGap)-barGap;
  const boxPad=70,boxGap=240,boxH=320,maxBarH=220;
  const boxCenterY=railY,entryX=X;
  const attnBoxLeft=entryX;
  const attnLeft=attnBoxLeft+boxPad,attnRight=attnLeft+zoneW;
  const attnBoxRight=attnRight+boxPad;
  const ffnBoxLeft=attnBoxRight+boxGap;
  const ffnLeft=ffnBoxLeft+boxPad,ffnRight=ffnLeft+zoneW;
  const ffnBoxRight=ffnRight+boxPad;
  const boxTop=boxCenterY-boxH/2,boxBottom=boxCenterY+boxH/2,baseline=boxBottom-30;

  // 흰색(어텐션)과 주황색(FFN)을 한 박스에 같이 두지 않고, 서로 다른 두 박스로
  // 나눈다 — 그래야 카메라가 각 박스에 맞춰 따로 더 가까이 줌인할 수 있다.
  // 두 박스는 레일 높이의 연결선으로 미리 이어져 있다.
  const attnBox=n('rect',{x:attnBoxLeft,y:boxTop,width:attnBoxRight-attnBoxLeft,height:boxH,rx:18,class:'txCandBox'});
  const ffnBox=n('rect',{x:ffnBoxLeft,y:boxTop,width:ffnBoxRight-ffnBoxLeft,height:boxH,rx:18,class:'txCandBox'});
  g.append(line(attnBoxRight,boxCenterY,ffnBoxLeft,boxCenterY,'txGuide'));
  const boxLabel=t(attnBoxLeft+24,boxTop-14,`TRANSFORMER LAYERS ×${numLayers}`,'txId');
  boxLabel.style.textAnchor='start';
  const attnLabel=t((attnLeft+attnRight)/2,boxTop+26,'SELF-ATTENTION','txProb');
  attnLabel.style.textAnchor='middle';
  const attnDesc=t((attnLeft+attnRight)/2,boxTop+44,'레이어별 셀프어텐션 출력 크기(실측값)','txProb');
  attnDesc.style.textAnchor='middle';
  const ffnLabel=t((ffnLeft+ffnRight)/2,boxTop+26,'FFN','txProb');
  ffnLabel.style.textAnchor='middle';
  const ffnDesc=t((ffnLeft+ffnRight)/2,boxTop+44,'레이어별 FFN(피드포워드) 출력 크기(실측값)','txProb');
  ffnDesc.style.textAnchor='middle';
  const introEls=[attnBox,ffnBox,boxLabel,attnLabel,attnDesc,ffnLabel,ffnDesc];
  introEls.forEach(el=>el.style.opacity=0);
  g.append(...introEls);
  requestAnimationFrame(()=>introEls.forEach(el=>{el.style.transition='opacity .8s';el.style.opacity=1}));

  // 박스 하나의 폭에 맞춰(전체 스팬이 아니라) 타이트하게 줌인하는 헬퍼 — 박스가
  // 둘로 나뉜 덕분에 각자 훨씬 자세히 볼 수 있다.
  function zoomToBox(bLeft,bRight){
    const stackW=(bRight-bLeft)+80,stackH=boxH+80;
    const zoomW=Math.max(VB_W0,stackW*1.02,stackH*1.02*(VB_W0/VB_H0));
    const zoomH=zoomW*(VB_H0/VB_W0);
    targetVBW=zoomW;
    targetVBH=zoomH;
    targetX=bLeft+(bRight-bLeft)/2-zoomW*0.5;
    targetY=boxCenterY-zoomH*0.5;
  }

  // 어텐션 막대(흰색)와 FFN 막대(주황색) — 둘 다 실제로 그 레이어의 셀프어텐션/
  // FFN 서브모듈 출력 크기를 잰 값이다(장식 아님). 처음엔 높이 0, 빛이 도착하면
  // 바닥에서 솟아오른다.
  // 막대마다 그 레이어의 실제 정규화 값(0~1)을 작은 숫자 태그로 위에 달아둔다 —
  // 막대가 다 자란 위치(최종 높이는 이미 알고 있으므로) 바로 위에 미리 놓고,
  // 막대가 켜지는 순간 같이 페이드인만 시킨다.
  const attnBars=layers.map((ly,i)=>{
    const x=attnLeft+i*(barW+barGap)+barW/2,h=Math.max(6,(ly.attn_norm||0)*maxBarH);
    const bar=n('rect',{x:x-barW/2,y:baseline,width:barW,height:0,rx:2,class:'txLayerAttnBar'});
    const valLabel=t(x,baseline-h-6,(ly.attn_norm||0).toFixed(2),'txLayerBarValue');
    valLabel.style.textAnchor='middle';
    valLabel.style.opacity=0;
    g.append(bar,valLabel);
    return{x,bar,h,valLabel};
  });
  const ffnBars=layers.map((ly,i)=>{
    const x=ffnLeft+i*(barW+barGap)+barW/2,h=Math.max(6,(ly.ffn_norm||0)*maxBarH);
    const bar=n('rect',{x:x-barW/2,y:baseline,width:barW,height:0,rx:2,class:'txLayerFfnBar'});
    const valLabel=t(x,baseline-h-6,(ly.ffn_norm||0).toFixed(2),'txLayerBarValue');
    valLabel.style.textAnchor='middle';
    valLabel.style.opacity=0;
    g.append(bar,valLabel);
    return{x,bar,h,valLabel};
  });

  // 레일을 타고 어텐션 박스 입구까지 이동한 뒤, 그 박스 하나에만 맞춰
  // 타이트하게 줌인한다.
  await centerOn(entryX,token);
  if(token!==runId)return ffnBoxRight+250;
  heroOverride=true;
  zoomToBox(attnBoxLeft,attnBoxRight);
  await wait(500);
  if(token!==runId)return ffnBoxRight+250;

  // ① 진입: 굵은 빛 한 줄기가 들어와 어텐션 박스 입구에서 사라진다.
  heroEl.classList.add('hidden');
  await wait(200);
  if(token!==runId)return ffnBoxRight+250;

  // ② 어텐션 구간: 레이어 수만큼 가는 빛 가닥으로 갈라져 각자 자기 막대로
  // 흩어져 도착하는 순간 바닥에서 막대가 솟아오른다.
  let merged=await forkFillMerge(g,token,{from:{x:attnLeft-40,y:boxCenterY},items:attnBars,baseline,mergeTo:{x:attnBoxRight+40,y:boxCenterY}});
  if(token!==runId){if(merged)merged.remove();return ffnBoxRight+250}

  // ③ 중간 합류: 잠깐 하나로 모인 채 머문다 — 그동안 카메라는 FFN 박스에
  // 맞춰 다시 타이트하게 줌인/이동하고, 합쳐진 빛도 연결선을 타고 FFN 박스
  // 입구까지 실제로 이동한다.
  await wait(200);
  if(token!==runId){if(merged)merged.remove();return ffnBoxRight+250}
  zoomToBox(ffnBoxLeft,ffnBoxRight);
  if(merged){
    await new Promise(done=>{
      const x0=+merged.getAttribute('cx'),x1=ffnLeft-40,start=performance.now();
      const dur=Math.max(400,Math.abs(x1-x0)/0.5);
      function step(now){
        if(token!==runId){done();return}
        const q=Math.min(1,(now-start)/dur),e=1-Math.pow(1-q,3);
        merged.setAttribute('cx',x0+(x1-x0)*e);
        if(q<1)requestAnimationFrame(step);else done();
      }
      requestAnimationFrame(step);
    });
  }else{
    await wait(400);
  }
  if(token!==runId){if(merged)merged.remove();return ffnBoxRight+250}

  // ④ FFN 구간: 도착한 그 자리에서 다시 갈라져 주황색 막대들을 채운다 —
  // merged를 그 자리에서 지우고 같은 프레임에 새로 포크하므로 틈이 없다.
  if(merged)merged.remove();
  merged=await forkFillMerge(g,token,{from:{x:ffnLeft-40,y:boxCenterY},items:ffnBars,baseline,mergeTo:{x:ffnBoxRight+40,y:boxCenterY}});
  if(token!==runId){if(merged)merged.remove();return ffnBoxRight+250}

  // ⑤ 탈출: 다시 하나의 깔끔한 빛으로 합쳐져 다음 단계로 직진한다 — 같은
  // 프레임에 hero가 이어받는다.
  if(merged)merged.remove();
  heroWorldX=ffnBoxRight+40;
  heroEl.setAttribute('cx',ffnBoxRight+40);
  heroEl.setAttribute('cy',boxCenterY);
  heroEl.classList.remove('hidden');
  heroOverride=false;
  await wait(250);
  if(token!==runId)return ffnBoxRight+250;

  // 카메라를 원래 배율로 되돌리는 동시에, 다음 박스(다음 토큰 예측)와 겹치지
  // 않도록 오른쪽으로 더 이동한다. 세로 기준점은 decodeZone의 후보 박스
  // 한가운데다(decodeZone과 같은 수치 — 그 박스는 레일 위 230만큼, 레일에서
  // 30 띄워 놓인다).
  camRate=0.11;
  targetVBW=VB_W0;
  targetVBH=VB_H0;
  targetY=(railY-30-115)-VB_H0*0.5;
  const clearX=ffnBoxRight+300;
  await centerOn(clearX,token);
  return clearX+250;
}

// 후보 경쟁 -> 선택된 토큰까지, 스텝마다 자기 자리를 갖고 레일 위에 그대로
// 쌓여서 답변이 왼쪽에서 오른쪽으로 실제로 만들어지는 궤적이 된다.
// 후보 4개는 확률 순이 아니라 무작위 세로 순서로 나오고, 점멸등이 실제로
// 움직이는 게 아니라 켜진 등 자체가 빠르게 자리를 바꾸다 1등에서 멈춘다.
// 새 점을 만들지 않는다 — 화면에 있는 단 하나의 빛(hero)이 직접 위로 올라와
// 박스에 들어가고, 당첨 후보 자리로 움직였다가, 다시 나와 메인선에 합류한다.
async function decodeZone(g,startX,data,token){
  const X=startX+280;
  station('04 / NEXT TOKEN (다음 토큰 예측)','다음으로 올 토큰의 확률을 계산하여 가장 높은 것을 선택합니다.');
  // 박스 폭이 300이라, 최소 간격이 너무 낮으면(예: 340 -> 테두리 사이 40) 답변이
  // 길어져 스텝이 많아질 때 박스끼리 거의 붙어 보인다 — 최소 간격을 넉넉히 둔다.
  const gap=Math.max(420,Math.min(640,10200/Math.max(data.steps.length-1,1)));
  // 박스는 항상 지금의 메인라인(railY) 기준 상대 위치다 — 임베딩 장을 거치며
  // 레일 높이가 바뀌어도 그대로 그 위에 놓인다.
  const boxBottom=railY-30,boxTop=boxBottom-230,enterTarget=(boxTop+boxBottom)/2;
  const rowY=[32,88,144,200].map(o=>boxTop+o);
  el.answer.innerHTML='answer stream: ';

  // 박스와 레일을 잇는 선은 카메라가 도착하는 순간 갑자기 생기는 게 아니라, 화면
  // 밖에 있을 때부터 미리 다 만들어 둔다 — 원래 거기 있던 것처럼 보이게 한다.
  // 안의 내용(막대·점멸등)만 그 단계 차례가 됐을 때 실제로 채워 넣는다.
  const boxes=data.steps.map((_,i)=>{
    const x=X+i*gap,lampX=x+118,exitX=x+150,dropX=exitX+40;
    const frame=n('g');
    // 후보 6개가 어디선가 짜잔 나타나는 게 아니라, 실제로는 전체 어휘(수만~십만
    // 개) 각각의 점수를 다 매긴 뒤 상위만 추린 것이다 — 그 규모감을 캡션으로
    // 보여준다.
    const scaleLabel=t(x,boxTop+18,`${(data.vocab_size||0).toLocaleString()} CANDIDATES SCORED → TOP 4`,'txProb');
    scaleLabel.style.textAnchor='middle';
    // 박스가 불투명해야 안쪽 내용(막대·점멸등)을 가리지 않고, 진입선도 박스 테두리에서
    // 끊겨 안이 비쳐 보이지 않는다 — 그래서 박스를 먼저, 내용은 그 위에 그린다.
    g.append(
      n('rect',{x:x-150,y:boxTop,width:300,height:boxBottom-boxTop,rx:8,class:'txCandBox'}),
      t(x,boxTop-14,'NEXT-TOKEN PREDICTION','txId'),
      scaleLabel,
      frame,
      line(x,railY,x,boxBottom,'txGuide'),
      line(exitX,enterTarget,dropX,enterTarget,'txGuide'),
      line(dropX,enterTarget,dropX,railY,'txGuide')
    );
    return{x,lampX,exitX,dropX,frame};
  });

  for(let i=0;i<data.steps.length;i++){
    if(token!==runId)return;
    const step=data.steps[i],cands=step.candidates.slice(0,4);
    const order=shuffle(cands.map((_,k)=>k));
    const{x,lampX,exitX,dropX,frame}=boxes[i];

    // 다음 박스로 넘어가기 전, 메인선을 타고 실제로 이동하는 모습이 보이도록 카메라를
    // 직접 옮기는 대신 빛의 좌표(heroWorldX)를 목표까지 이동시키고 기다린다 —
    // 카메라(데드존)는 이 이동을 보고 필요할 때만 따라온다.
    await centerOn(x,token);
    if(token!==runId)return;

    const bail=()=>{heroFront();heroEl.classList.remove('hidden');heroOverride=false};

    // 빛은 이미 centerOn으로 박스 가운데(x)까지 메인선을 타고 이동해 있다 — 여기서
    // 곧장 위로 올라가 사라진다. 박스 경계를 넘는 순간부터는 hero를 박스(g)보다
    // 뒤로 보내 불투명한 박스 표면에 진짜로 가려지게 한다.
    heroEl.setAttribute('cx',x);
    heroOverride=true;
    heroBehind(g);
    await anim(280,e=>heroEl.setAttribute('cy',railY+(boxBottom-railY)*e),token);
    if(token!==runId){bail();return}
    heroEl.classList.add('hidden');
    heroEl.setAttribute('cy',enterTarget);
    if(token!==runId){bail();return}

    const rows=[];
    for(let r=0;r<order.length;r++){
      if(token!==runId){bail();return}
      const item=cands[order[r]],y=rowY[r];
      const bar=n('rect',{x:x-90,y:y-5,width:0,height:11,rx:2,class:'txBar'});
      const lamp=dot(lampX,y,4,'txLamp');
      const label=t(x-95,y+9,show(item.token).slice(0,7),'txCandidateText');
      label.setAttribute('text-anchor','end');
      frame.append(n('rect',{x:x-90,y:y-5,width:175,height:11,rx:2,class:'txBarBg'}),bar,label,lamp);
      requestAnimationFrame(()=>bar.setAttribute('width',Math.max(3,item.prob*175)));
      rows.push({y,bar,lamp,label});
      await wait(85);
    }
    if(token!==runId){bail();return}
    await wait(100);

    // 점멸등 고르기: 빛이 실제로 오가는 게 아니라, 켜진 등이 이 행 저 행으로
    // 빠르게 옮겨붙다가 실제 1등 후보(무작위로 배치된 자리) 위에서 멈춘다.
    const winnerRow=order.indexOf(0),hops=[1,3,0,2,3,1,0,2,winnerRow],speeds=[28,30,33,38,45,55,68,83,105];
    for(let k=0;k<hops.length;k++){
      if(token!==runId){bail();return}
      rows.forEach((row,ri)=>row.lamp.classList.toggle('on',ri===hops[k]));
      await wait(speeds[k]);
    }
    if(token!==runId){bail();return}
    rows[winnerRow].bar.classList.add('win');
    rows[winnerRow].label.classList.add('win');
    await wait(160);
    if(token!==runId){bail();return}

    // 단어가 골라진 그 순간, 박스 오른쪽 변 가운데에서 같은 빛이 다시 나타난다.
    // 다시 보여야 하니 hero를 원래 자리(맨 앞)로 돌려놓는다.
    heroFront();
    heroEl.setAttribute('cx',exitX);
    heroEl.setAttribute('cy',enterTarget);
    heroEl.classList.remove('hidden');
    await wait(80);
    if(token!==runId){bail();return}
    rows[winnerRow].lamp.classList.remove('on');
    rows[winnerRow].lamp.classList.add('done');
    rows[winnerRow].bar.classList.remove('win');
    rows[winnerRow].bar.classList.add('done');

    // 같은 빛이 그대로 아래로 내려가 다시 메인선에 합류한다.
    await anim(90,e=>heroEl.setAttribute('cx',exitX+(dropX-exitX)*e),token);
    await anim(150,e=>heroEl.setAttribute('cy',enterTarget+(railY-enterTarget)*e),token);
    heroWorldX=dropX;
    heroOverride=false;
    if(token!==runId)return;
    el.answer.innerHTML+=`<b>${show(step.selected)}</b> `;
  }
  el.metric.textContent=`COMPLETE · ${data.answer.trim().length} CHARACTERS GENERATED`;
}

// 마지막 후보 박스를 지나면, 빛은 계속 메인선을 타고 4초를 더 이동해 거대한 응답
// 박스에 다다른다(다른 박스와 같은 문법으로 진입). 세계는 하나로 이어져 있으므로
// 줌아웃하면 지나온 회로들도 함께 드러난다 — 그 안에 원문 그대로의 답변이 채워진다.
async function finaleZone(g,answer,token){
  const startX=heroWorldX;
  // 박스는 항상 지금의 메인라인(railY) 기준 상대 위치다.
  const blockW=1500,blockBottom=railY-30,blockTop=blockBottom-260,blockMidY=(blockTop+blockBottom)/2;
  // 진입은 박스 왼쪽 변 중앙으로 — 레일에서 곧장 그 높이까지 올라온 뒤, 옆으로
  // 미끄러져 들어간다(다른 박스의 "올라갔다 옆으로" 진입/퇴장과 같은 문법).
  const approachX=startX+2200,entryX=approachX+90,blockX=entryX+blockW/2;

  g.append(line(approachX,railY,approachX,blockMidY,'txGuide'),line(approachX,blockMidY,entryX,blockMidY,'txGuide'));
  const block=n('rect',{x:entryX,y:blockTop,width:blockW,height:blockBottom-blockTop,rx:18,class:'txCandBox'});
  block.style.opacity=0;
  const finalLabel=t(entryX+24,blockTop-14,'FINAL OUTPUT','txId');
  finalLabel.style.textAnchor='start';
  finalLabel.style.opacity=0;
  g.append(block,finalLabel);
  requestAnimationFrame(()=>{
    block.style.transition='opacity .8s';block.style.opacity=1;
    finalLabel.style.transition='opacity .8s';finalLabel.style.opacity=1;
  });

  // 4초 동안 메인라인을 타고 실제로 이동해 진입 지점까지 온다 — 카메라는 데드존
  // 그대로 필요할 때만 따라오므로, override로 넘어갈 때는 이미 화면 안에 있다.
  await new Promise(done=>{
    const dist=approachX-startX,t0=performance.now(),dur=4000;
    function step(now){
      if(token!==runId){done();return}
      const q=Math.min(1,(now-t0)/dur);
      heroWorldX=startX+dist*q;
      if(q<1)requestAnimationFrame(step);else done();
    }
    requestAnimationFrame(step);
  });
  if(token!==runId)return;

  // 다른 박스와 같은 문법으로 — 레일에서 위(정확히는 박스 왼쪽 변 높이)로 올라간
  // 뒤, 옆으로 미끄러져 그 안으로 사라진다.
  heroOverride=true;
  heroEl.setAttribute('cx',approachX);
  await anim(420,e=>heroEl.setAttribute('cy',railY+(blockMidY-railY)*e),token);
  if(token!==runId){heroOverride=false;return}
  // 박스 왼쪽 변을 넘어 안으로 들어가는 순간부터는 hero를 박스(g)보다 뒤로 보내
  // 불투명한 박스 표면에 진짜로 가려지게 한다.
  heroBehind(g);
  await anim(320,e=>heroEl.setAttribute('cx',approachX+(entryX-approachX)*e),token);
  if(token!==runId){heroOverride=false;return}
  heroEl.classList.add('hidden');
  await wait(200);
  if(token!==runId)return;

  // 빛이 안전하게 들어간 다음에야 카메라가 서서히 줌아웃(뷰박스가 커짐)된다 —
  // 이번엔 화면 정중앙에 박스가 오도록 박스 한가운데를 기준으로 확대한다.
  // 동시에 제목/설명, 질문, 답변 스트림 같은 주변 UI는 다 사라지고, 박스와
  // 그 박스로 이어지는 선, 처음으로 버튼만 화면에 남는다 — 마지막이니까.
  const blockCenterY=(blockTop+blockBottom)/2;
  const zoomW=blockW+900,zoomH=zoomW*(VB_H0/VB_W0);
  camRate=0.045;
  targetX=blockX-zoomW*0.5;
  targetY=blockCenterY-zoomH*0.5;
  targetVBW=zoomW;
  targetVBH=zoomH;
  el.stageInfo.classList.remove('show');
  el.source.classList.remove('show');
  el.answer.style.transition='opacity .8s';
  el.answer.style.opacity=0;
  await wait(2600);
  if(token!==runId)return;
  const scale=zoomW/VB_W0;

  // 생성 중 보여주던 ·(공백)·↵(줄바꿈) 같은 자리표시 기호가 아니라, 모델이 실제로
  // 만든 문장 원문 그대로(띄어쓰기·줄바꿈 포함)를, 조금 픽셀 느낌이 나는 글꼴로 채운다.
  // 문장이 길어 줄 수가 늘어나면 세로 공간을 넘칠 수 있으므로, 다 들어갈 때까지
  // 글자 크기를 조금씩 줄여가며 다시 줄바꿈한다.
  const maxW=blockW-180,maxH=blockBottom-blockTop-80;
  const fam="'Galmuri11',Consolas,monospace";
  function wrap(fpx){
    const st=`font-size:${fpx}px;font-family:${fam}`,ls=[];
    answer.trim().split(/\n+/).forEach(p=>{
      const ws=p.split(/\s+/).filter(Boolean);
      let cur='';
      ws.forEach(w=>{
        const test=cur?cur+' '+w:w;
        if(cur&&measureText(test,'txBigToken',st)>maxW){ls.push(cur);cur=w}
        else cur=test;
      });
      if(cur)ls.push(cur);
    });
    return ls;
  }
  // totalH(베이스라인 간격의 합, (줄수-1)*lineH)는 가운데 정렬용으로는 맞지만,
  // "들어가는지" 판정에는 부족하다 — 마지막 줄 자체의 글자 높이를 안 세서, 실제
  // 렌더링되는 높이보다 항상 lineH 하나만큼 적게 계산돼 박스 밑으로 삐져나왔다.
  // fit 판정은 줄 수만큼(글자 높이 포함) 전부 세는 별도 값으로 한다.
  let fontPx=34*scale,lineH=fontPx*1.7,lines=wrap(fontPx),fitH=lines.length*lineH;
  const minFontPx=14*scale;
  while(fitH>maxH&&fontPx>minFontPx){
    fontPx*=0.9;
    lineH=fontPx*1.7;
    lines=wrap(fontPx);
    fitH=lines.length*lineH;
  }
  const totalH=(lines.length-1)*lineH;
  const styleExtra=`font-size:${fontPx}px;font-family:${fam}`;
  // y는 글자의 시각적 중심이 아니라 베이스라인이라, 줄 개수만으로 top0을 계산하면
  // 폰트의 올림/내림(ascent/descent)만큼 위로 치우쳐 보인다 — 실제로 그려진
  // bbox를 재서 그 중심을 blockMidY에 맞춘다.
  const top0=blockMidY-totalH/2;
  const lineEls=lines.map((ln,i)=>{
    const le=t(blockX,top0+i*lineH,ln,'txBigToken');
    le.style.cssText=styleExtra;
    g.append(le);
    return le;
  });
  const boxes=lineEls.map(le=>le.getBBox());
  const minY=Math.min(...boxes.map(b=>b.y)),maxY=Math.max(...boxes.map(b=>b.y+b.height));
  const shift=blockMidY-(minY+maxY)/2;
  lineEls.forEach(le=>{
    le.setAttribute('y',+le.getAttribute('y')+shift);
    le.style.opacity=0;
    requestAnimationFrame(()=>{le.style.transition='opacity .6s';le.style.opacity=1});
  });
  el.metric.textContent=`COMPLETE · ${answer.trim().length} CHARACTERS`;

  // 다른 UI가 다 사라지고 답변이 완전히 자리잡은 마지막 순간에야, 이 전체 과정이
  // "raw 토큰 출력을 평문으로 바꾼 것"이었다는 설명이 뒤늦게 페이드인으로 나온다.
  await wait(700);
  if(token!==runId)return;
  station('05 / DETOKENIZATION (평문화)','LLM 전용 포맷으로 생성된 raw 토큰 출력을 사람이 읽는 자연스러운 문장으로 변환합니다.');
  requestAnimationFrame(()=>el.stageInfo.classList.add('show'));
}

// 1단계(토큰화)는 실제 모델을 전혀 쓰지 않는다(글자를 코드값으로 바꾸는 것뿐) —
// 그래서 서버 응답을 기다렸다가 시작하지 않고, 요청을 백그라운드로 흘려보낸 채
// 1단계를 곧장 시작한다. 실제 데이터(임베딩·후보·답변)가 필요한 2단계 직전에만
// 그 요청이 끝나기를 기다린다 — 1단계가 진행되는 동안 모델 로딩 시간이 자연스럽게
// 채워진다. 레일 길이는 아직 모르는 스텝 수 대신, backend의 MAX_NEW_TOKENS(40)
// 기준 최대치로 미리 잡아 둔다.
async function play(dataPromise,question){
  const token=++runId,input=words(question);
  const g=world(3200+40*640+700+4000+2700);
  el.stage.classList.add('running');
  el.answer.innerHTML='';
  el.source.textContent='';
  const{label,tspans}=await introZone(g,input,token);
  if(token!==runId)return;
  const afterTok=await tokenZone(g,input,token,label,tspans);
  if(token!==runId)return;
  let data;
  try{
    data=await dataPromise;
  }catch{
    if(token!==runId)return;
    resetToForm('추론 서버에 연결하지 못했습니다. backend/server.py로 실행해야 실제 답변을 생성합니다.');
    return;
  }
  if(token!==runId)return;
  el.name.textContent=`${data.model.toUpperCase()} · INFERENCE CURRENT`;
  const afterEmb=await embeddingZone(g,afterTok,data,token);
  if(token!==runId)return;
  const afterLayers=await transformerZone(g,afterEmb,data,token);
  if(token!==runId)return;
  await decodeZone(g,afterLayers,data,token);
  if(token!==runId)return;
  await finaleZone(g,data.answer,token);
}

async function requestTrace(q){
  const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})});
  if(!r.ok)throw new Error();
  return r.json();
}
el.form.addEventListener('submit',async e=>{
  e.preventDefault();
  const q=el.input.value.trim();
  if(!q)return;
  // RUN을 누르는 즉시(로딩을 기다리지 않고) 입력폼을 그 자리에서 없애고, 입력창과
  // 완전히 같은 폰트/크기 + 실제로 입력창이 있던 화면 자리로 디코이 문장을
  // 바꿔치기한다. 그 자리는 계산이 아니라, 폼을 감추기 전에 입력창을 직접 재서
  // (getBoundingClientRect) 얻은 실측값이다 — SVG 좌표 투영을 거치면 SVG가 뷰포트
  // 전체를 덮지 않는 한 입력창의 실제 자리(화면 정중앙)와 정확히 일치한다는 보장이
  // 없어서, 아예 그 계산을 거치지 않고 입력창 자신의 위치를 그대로 물려받는다.
  const inputRect=el.input.getBoundingClientRect();
  const inputCx=inputRect.left+inputRect.width/2,inputCy=inputRect.top+inputRect.height/2;
  el.form.style.display='none';
  el.suggest.style.display='none';
  el.decoy.textContent=q;
  el.decoy.style.left=inputCx+'px';
  el.decoy.style.top=inputCy+'px';
  el.decoy.classList.add('show');
  // 1단계가 아직 진행 중일 때 요청이 먼저 실패하면(예: 서버 꺼짐) 여기서 바로
  // await하지 않으므로, 아무도 구독하지 않은 채 뜨는 "unhandled rejection" 콘솔
  // 경고를 막기 위해 빈 catch를 하나 미리 걸어 둔다 — 실제 에러 처리는 play()
  // 안에서 나중에 이 프로미스를 await할 때 한다.
  const dataPromise=requestTrace(q);
  dataPromise.catch(()=>{});
  play(dataPromise,q);
});
// 추천 질문 박스: 클릭하면 그 문장을 입력창에 채우고 그대로 제출한다.
el.suggest.querySelectorAll('button').forEach(btn=>{
  btn.addEventListener('click',()=>{
    el.input.value=btn.textContent;
    el.form.requestSubmit();
  });
});
// 처음으로 돌아가기: 진행 중인 애니메이션은 runId를 바꿔 각 단계의 token!==runId
// 체크에서 스스로 멈추게 하고, 화면은 최초 입력 폼 상태로 되돌린다.
function resetToForm(hintMsg){
  ++runId;
  heroOverride=false;
  el.svg.replaceChildren();
  el.stage.classList.remove('running');
  el.reset.classList.remove('show');
  el.source.textContent='';
  el.answer.innerHTML='';
  // finaleZone이 답변 스트림을 인라인 opacity로 직접 숨기는데(0으로), 여기서
  // 되돌려놓지 않으면 다음 실행의 3단계(답변 스트림이 실시간으로 보여야 하는
  // 곳)까지 계속 투명한 채로 남아 있었다.
  el.answer.style.opacity='';
  el.answer.style.transition='';
  el.name.textContent='TOKEN CURRENT';
  el.metric.textContent='INITIALIZING';
  el.stageTitle.textContent='';
  el.stageSub.textContent='';
  el.stageInfo.classList.remove('show');
  el.source.classList.remove('show');
  el.hint.textContent=hintMsg||defaultHint;
  el.decoy.classList.remove('show');
  el.decoy.textContent='';
  el.form.style.display='';
  el.suggest.style.display='';
  el.input.focus();
}
el.reset.addEventListener('click',()=>resetToForm());
