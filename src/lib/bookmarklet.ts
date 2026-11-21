/**
 * "Enviar para o Leitura": o favorito que roda na pagina aberta no navegador.
 *
 * Alguns sites recusam pedidos vindos de servidores (o da Vercel incluso),
 * mas abrem normalmente no celular. O favorito le a pagina ja carregada e as
 * seguintes (`?page=2`, 3...), com o acesso da propria pessoa, e envia o HTML
 * a `/api/receber`, que extrai o texto com o mesmo parser da importacao por
 * link. O envio e um formulario comum (POST de navegacao): nao depende de
 * CORS nem de cookie, e a sessao so entra quando o app abre a previa.
 */

/** Teto do HTML enviado: a Vercel recusa corpos acima de 4,5 MB. */
export const MAX_SENT_CHARS = 3_500_000;
/** Paginas juntadas pelo navegador, as mesmas da importacao completa. */
export const MAX_SENT_PAGES = 50;
/** Chave da passagem entre a resposta de `/api/receber` e "Novo texto". */
export const RECEIVED_KEY = "leitura:recebido";

/**
 * Codigo do favorito. Escrito com ponto e virgula em toda instrucao e sem
 * comentarios de linha: as quebras sao removidas no fim.
 */
const SOURCE = `(async function(){
var A=__ORIGIN__,M=__MAX_CHARS__,L=__MAX_PAGES__;
function c(d){
d.querySelectorAll('script:not([type="application/ld+json"]),style,noscript,svg,iframe,template,img,picture,video,audio,source,link:not([rel="canonical"])').forEach(function(e){e.remove();});
return '<!doctype html>'+d.documentElement.outerHTML;
}
function n(d,p){return d.querySelector('a[href*="page='+p+'"]');}
var h=[c(document.cloneNode(true))];
var b=document.createElement('div');
b.setAttribute('role','status');
b.style.cssText='position:fixed;z-index:2147483647;left:8px;right:8px;bottom:8px;padding:14px 16px;border-radius:12px;background:#1d1b20;color:#fff;font:16px/1.4 sans-serif;box-shadow:0 2px 8px #0006';
b.textContent='Lendo a página...';
document.body.appendChild(b);
document.addEventListener('securitypolicyviolation',function(e){
if(String(e.violatedDirective).indexOf('form-action')===0){b.textContent='O site bloqueou o envio. Copie o texto e use a aba Colar no Leitura.';}
});
try{
var u=new URL(location.href),p=Number(u.searchParams.get('page'))||1,t=h[0].length,x=0,d=document;
while(n(d,p+1)){
if(h.length>=L){x=1;break;}
u.searchParams.set('page',String(p+1));
b.textContent='Lendo a página '+(p+1)+'...';
var r=await fetch(u.href,{credentials:'include'});
if(!r.ok){break;}
d=new DOMParser().parseFromString(await r.text(),'text/html');
var s=c(d);
if(t+s.length>M){x=1;break;}
h.push(s);t+=s.length;p+=1;
}
var f=document.createElement('form');
f.method='post';f.action=A+'/api/receber';f.enctype='multipart/form-data';f.acceptCharset='UTF-8';f.style.display='none';
function a(k,v){var e=document.createElement('textarea');e.name=k;e.value=v;f.appendChild(e);}
a('url',location.href);
if(x){a('parcial','1');}
h.forEach(function(v){a('html',v);});
document.body.appendChild(f);
b.textContent='Enviando para o Leitura...';
f.submit();
}catch(e){b.textContent='Não consegui ler a página: '+(e&&e.message||e);}
})();`;

/** O codigo do favorito para o app servido em `origin`, sem o prefixo. */
export function bookmarkletCode(origin: string): string {
  return SOURCE.replace("__ORIGIN__", JSON.stringify(origin))
    .replace("__MAX_CHARS__", String(MAX_SENT_CHARS))
    .replace("__MAX_PAGES__", String(MAX_SENT_PAGES))
    .replace(/\n/g, "");
}

/** O endereco que vai no favorito: `javascript:` e o codigo codificado. */
export function bookmarkletUrl(origin: string): string {
  return `javascript:${encodeURIComponent(bookmarkletCode(origin))}`;
}
