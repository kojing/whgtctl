var ML = {ft:700, fb:0, mid:350, top:740, bot:-40, band:4, spanK:2, lTop:'キャップハイト', lBot:'ベースライン'};
var MK = {ft:760, fb:-70, mid:345, top:820, bot:-130, band:60, spanK:4, lTop:'字面上端', lBot:'字面下端'};
var STEP = 6, CAPD = 100, KAPPA = 0.5523;

/* ---------- 幾何ユーティリティ ---------- */
function smooth(d,R){ return d >= R ? 0 : (1+Math.cos(Math.PI*d/R))/2; }
function clipPoly(poly,f){
  var out=[], n=poly.length;
  for (var i=0;i<n;i++){
    var a=poly[i], b=poly[(i+1)%n], fa=f(a), fb=f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)){ var t=fa/(fa-fb); out.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]); }
  }
  return out;
}
function polyArea(poly){ var s=0; for (var i=0;i<poly.length;i++){ var a=poly[i], b=poly[(i+1)%poly.length]; s+=a[0]*b[1]-b[0]*a[1]; } return s/2; }
function median(v){ if (!v.length) return 0; var c=v.slice().sort(function(a,b){ return a-b; }); return c[Math.floor(c.length/2)]; }

/* ---------- パス表現：セグメント {a, c1, c2, b, line} の閉じた列 ---------- */
function L(a,b){ return {a:a, c1:a, c2:b, b:b, line:true}; }
function Cv(a,c1,c2,b){ return {a:a, c1:c1, c2:c2, b:b, line:false}; }
function fromPoly(pts){ var s=[]; for (var i=0;i<pts.length;i++) s.push(L(pts[i], pts[(i+1)%pts.length])); return s; }
function reverseC(segs){ return segs.slice().reverse().map(function(g){ return {a:g.b, c1:g.c2, c2:g.c1, b:g.a, line:g.line}; }); }
function bez(g,t){ var u=1-t; return [u*u*u*g.a[0]+3*u*u*t*g.c1[0]+3*u*t*t*g.c2[0]+t*t*t*g.b[0], u*u*u*g.a[1]+3*u*u*t*g.c1[1]+3*u*t*t*g.c2[1]+t*t*t*g.b[1]]; }
function bezD(g,t){ var u=1-t; return [3*u*u*(g.c1[0]-g.a[0])+6*u*t*(g.c2[0]-g.c1[0])+3*t*t*(g.b[0]-g.c2[0]), 3*u*u*(g.c1[1]-g.a[1])+6*u*t*(g.c2[1]-g.c1[1])+3*t*t*(g.b[1]-g.c2[1])]; }
function nrm(v){ var l=Math.hypot(v[0],v[1])||1; return [v[0]/l, v[1]/l]; }
function startTan(g){ return nrm(g.line ? [g.b[0]-g.a[0], g.b[1]-g.a[1]] : bezD(g, 0.001)); }
function endTan(g){ return nrm(g.line ? [g.b[0]-g.a[0], g.b[1]-g.a[1]] : bezD(g, 0.999)); }
function flatten(segs){ var pts=[]; segs.forEach(function(g){ var k=g.line ? 1 : 16; for (var j=0;j<k;j++) pts.push(bez(g, j/k)); }); return pts; }
function orientC(segs, pos){ var a=polyArea(flatten(segs)); return ((a >= 0) === pos) ? segs : reverseC(segs); }

/* ---------- サンプル入力：Illustrator 上の塗りパス（重なり・太さムラあり、曲線はベジェ） ---------- */
function box(x0,y0,x1,y1){ return fromPoly([[x0,y0],[x1,y0],[x1,y1],[x0,y1]]); }
function slab(xa,ya,xb,yb,th,m){
  var dx=xb-xa, dy=yb-ya, Ln=Math.hypot(dx,dy), ux=dx/Ln, uy=dy/Ln, nx=-uy*th/2, ny=ux*th/2;
  xa-=ux*th; ya-=uy*th; xb+=ux*th; yb+=uy*th;
  var q=[[xa+nx,ya+ny],[xb+nx,yb+ny],[xb-nx,yb-ny],[xa-nx,ya-ny]];
  q=clipPoly(q, function(v){ return v[1]-m.fb; }); q=clipPoly(q, function(v){ return m.ft-v[1]; });
  if (polyArea(q) < 0) q.reverse();
  return fromPoly(q);
}
function ellipseC(cx,cy,rx,ry,ccw){
  var k=KAPPA, P=[[cx+rx,cy],[cx,cy+ry],[cx-rx,cy],[cx,cy-ry]], s=[];
  s.push(Cv(P[0],[cx+rx,cy+ry*k],[cx+rx*k,cy+ry],P[1]));
  s.push(Cv(P[1],[cx-rx*k,cy+ry],[cx-rx,cy+ry*k],P[2]));
  s.push(Cv(P[2],[cx-rx,cy-ry*k],[cx-rx*k,cy-ry],P[3]));
  s.push(Cv(P[3],[cx+rx*k,cy-ry],[cx+rx,cy-ry*k],P[0]));
  return ccw ? s : reverseC(s);
}
// 筆の中心線（ベジェ）から塗りの輪郭を作る：側面はベジェ、端は丸（四分円2つ）
function brush(cl, th){
  var h=th/2, k=KAPPA*h, Ls=[], Rs=[];
  function add(p,v,s){ return [p[0]+v[0]*s, p[1]+v[1]*s]; }
  cl.forEach(function(c){
    var g={a:[c[0],c[1]], c1:[c[2],c[3]], c2:[c[4],c[5]], b:[c[6],c[7]], line:false};
    var t0=startTan(g), t1=endTan(g), n0=[-t0[1],t0[0]], n1=[-t1[1],t1[0]];
    Ls.push(Cv(add(g.a,n0,h), add(g.c1,n0,h), add(g.c2,n1,h), add(g.b,n1,h)));
    Rs.push(Cv(add(g.a,n0,-h), add(g.c1,n0,-h), add(g.c2,n1,-h), add(g.b,n1,-h)));
  });
  var gl=Ls[Ls.length-1], E=[cl[cl.length-1][6], cl[cl.length-1][7]];
  var gE={a:[0,0], c1:[0,0], c2:[cl[cl.length-1][4], cl[cl.length-1][5]], b:E, line:false}, tE=nrm([E[0]-gE.c2[0], E[1]-gE.c2[1]]), nE=[-tE[1],tE[0]];
  var S=[cl[0][0], cl[0][1]], tS=nrm([cl[0][2]-S[0], cl[0][3]-S[1]]), nS=[-tS[1],tS[0]];
  var A1=add(E,nE,h), M1=add(E,tE,h), B1=add(E,nE,-h);
  var capE=[Cv(A1, add(A1,tE,k), add(M1,nE,k), M1), Cv(M1, add(M1,nE,-k), add(B1,tE,k), B1)];
  var A2=add(S,nS,-h), M2=add(S,tS,-h), B2=add(S,nS,h);
  var capS=[Cv(A2, add(A2,tS,-k), add(M2,nS,-k), M2), Cv(M2, add(M2,nS,k), add(B2,tS,-k), B2)];
  return orientC(Ls.concat(capE, reverseC(Rs), capS), true);
}

var INPUT = {
  'H':{adv:652, k:0, c:[box(60,0,148,700), box(500,0,592,700), box(100,310,550,398)]},
  'O':{adv:700, k:0, c:[ellipseC(350,350,300,350,true), ellipseC(350,350,210,266,false)]},
  'T':{adv:620, k:0, c:[box(30,610,590,700), box(266,0,356,640)]},
  'A':{adv:620, k:0, c:[slab(90,0,310,700,92,ML), slab(530,0,310,700,90,ML), box(150,180,470,264)]},
  'V':{adv:620, k:0, c:[slab(90,700,310,0,92,ML), slab(530,700,310,0,90,ML)]},
  'X':{adv:620, k:0, c:[slab(80,0,540,700,90,ML), slab(540,0,80,700,88,ML)]},
  'E':{adv:580, k:0, c:[box(60,0,150,700), box(60,614,500,700), box(60,306,450,390), box(60,0,520,88)]},
  'い':{adv:900, k:1, c:[brush([[230,650,200,430,195,190,275,95],[275,95,300,65,335,110,350,165]],92), brush([[610,560,690,500,735,420,745,300]],86)]},
  'う':{adv:900, k:1, c:[brush([[390,720,450,700,520,680,580,660]],84), brush([[250,470,420,550,700,570,700,340],[700,340,700,120,520,0,320,-30]],92)]},
  'こ':{adv:900, k:1, c:[brush([[290,600,420,630,560,640,650,615]],90), brush([[230,230,250,90,400,60,700,110]],94)]},
  'し':{adv:900, k:1, c:[brush([[330,730,320,500,300,260,330,130],[330,130,360,20,560,10,730,210]],92)]},
  'す':{adv:900, k:1, c:[brush([[120,570,350,590,600,600,800,575]],88), brush([[460,770,462,650,464,520,466,400],[466,400,470,220,440,80,340,-20]],92), ellipseC(392,415,92,84,true), ellipseC(392,415,24,22,false)]},
  'の':{adv:900, k:1, c:[brush([[470,630,440,420,380,200,290,70],[290,70,240,0,140,120,150,330],[150,330,160,600,380,720,520,700],[520,700,720,680,800,500,760,330],[760,330,720,150,600,60,510,40]],90)]}
};
var LATIN = ['H','O','T','A','V','X','E'];
var KANA = ['い','う','こ','し','す','の'];

/* ---------- 内外判定とレイ（平坦化した輪郭で計算） ---------- */
function windingAt(cs, x, y){
  var w=0;
  for (var c=0;c<cs.length;c++){
    var P=cs[c], n=P.length;
    for (var i=0;i<n;i++){
      var a=P[i], b=P[(i+1)%n], isl=(b[0]-a[0])*(y-a[1])-(x-a[0])*(b[1]-a[1]);
      if (a[1] <= y){ if (b[1] > y && isl > 0) w++; }
      else if (b[1] <= y && isl < 0) w--;
    }
  }
  return w;
}
function rayExit(cs, edges, qx, qy, nx, ny){
  var w=windingAt(cs, qx, qy); if (w === 0) return 0;
  var hits=[];
  for (var k=0;k<edges.length;k++){
    var e=edges[k], ex=e[2]-e[0], ey=e[3]-e[1], den=nx*ey-ny*ex;
    if (Math.abs(den) < 1e-9) continue;
    var ax=e[0]-qx, ay=e[1]-qy, t=(ax*ey-ay*ex)/den, u=(ax*ny-ay*nx)/den;
    if (t > 1e-6 && u >= 0 && u < 1) hits.push([t, (ex*ny-ey*nx) > 0 ? 1 : -1]);
  }
  hits.sort(function(a,b){ return a[0]-b[0]; });
  for (var h=0;h<hits.length;h++){ w += hits[h][1]; if (w === 0) return hits[h][0]; }
  return 1200;
}

