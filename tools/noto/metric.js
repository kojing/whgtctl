// Noto Sans JP の本物の Thin / Bold / Black と、Regular から合成した字形の IoU を測る
//   cd tools/noto && node metric.js   （kana.json が必要。extract_kana.py を参照）
var fs=require('fs'), path=require('path');
var jsx=fs.readFileSync(path.join(__dirname,'..','..','scripts','OpticalCorrection.jsx'),'utf8').replace(/^\uFEFF/,'');
var A0=jsx.lastIndexOf('/* =====',jsx.indexOf('/* ES3 用の最小ポリフィル')), B0=jsx.lastIndexOf('/* =====',jsx.indexOf('/* Illustrator との入出力'));
eval(jsx.slice(A0,B0)+fs.readFileSync(path.join(__dirname,'loader.js'),'utf8'));
var F=JSON.parse(fs.readFileSync(path.join(__dirname,'kana.json'),'utf8'));
var s=700/(FONT_M.ft-FONT_M.fb), m={ft:700,fb:0,mid:350,band:50,spanK:4};
function setOf(w,chars){ var ws=[], L={}; chars.forEach(function(ch){ var A=analyzeGlyph(glyphContours(F[w][ch],s), m); L[ch]=A; ws=ws.concat(glyphVerticalWidths(A)); }); var W2=median(ws); chars.forEach(function(ch){finishGlyph(L[ch],W2);}); return {As:L, ST:computeStems(chars.map(function(c){return L[c];}),W2), Wm:W2}; }
function raster(C){ var polys=C.map(function(sg){ var P=flattenSegs(sg,16); var bb=[1e9,1e9,-1e9,-1e9]; P.forEach(function(q){ bb[0]=Math.min(bb[0],q[0]); bb[1]=Math.min(bb[1],q[1]); bb[2]=Math.max(bb[2],q[0]); bb[3]=Math.max(bb[3],q[1]); }); P.bb=bb; return P; });
  var N=120, out=new Uint8Array(N*N); for (var j=0;j<N;j++){ var y=-50+j*(800/N)+3.3; for (var i=0;i<N;i++){ var x=-400+i*(800/N)+3.3; out[j*N+i]=windingAt(polys,x,y)!==0?1:0; } } return out; }
function iou(a,b){ var I=0,U=0; for (var k=0;k<a.length;k++){ if (a[k]&&b[k]) I++; if (a[k]||b[k]) U++; } return U?I/U:1; }
var kata=Object.keys(F.Regular).filter(function(c){return c.charCodeAt(0)>=0x30A0;}), hira=Object.keys(F.Regular).filter(function(c){return c.charCodeAt(0)<0x30A0;});
var sample=hira.filter(function(c,i){return i%2===0;}).concat(kata.filter(function(c,i){return i%2===0;}));
var R=setOf('Regular',sample), T={}; ['Thin','Bold','Black'].forEach(function(w){ T[w]=setOf(w,sample); });
var realR={}; ['Thin','Bold','Black'].forEach(function(w){ realR[w]={}; sample.forEach(function(ch){ realR[w][ch]=raster(glyphContours(F[w][ch],s)); }); });
global.evalAll=function(extra){ var res={}; ['Thin','Bold','Black'].forEach(function(w){ var p={W:T[w].ST.V/R.ST.V,uni:0,tol:0.3,ratio:T[w].ST.ratio,dg:0,mg:0.35,cp:0,os:0,oc:0,prec:2}; for (var k in extra) p[k]=extra[k];
  var v=[], anc=0; sample.forEach(function(ch){ var C=deformGlyph(R.As[ch],R.ST,p); C.forEach(function(sg){anc+=sg.length;}); v.push(iou(raster(C),realR[w][ch])); }); v.sort(function(a,b){return a-b;});
  res[w]={mean:(v.reduce(function(a,b){return a+b;},0)/v.length).toFixed(4), p10:v[Math.floor(v.length*0.1)].toFixed(4), anc:anc}; }); return res; };
global.baseIou=function(){ var res={}; ['Thin','Bold','Black'].forEach(function(w){ var v=sample.map(function(ch){ return iou(raster(glyphContours(F.Regular[ch],s)),realR[w][ch]); }); res[w]=(v.reduce(function(a,b){return a+b;},0)/v.length).toFixed(4); }); return res; };

if (require.main === module) {
  console.log('変形なし', JSON.stringify(baseIou()));
  console.log('既定値', JSON.stringify(evalAll({ext:0.5,tiny:0.35,smooth:5})));
}
