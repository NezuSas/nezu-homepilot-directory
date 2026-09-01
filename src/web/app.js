import { enterHome } from './navigation.js';
import { invitationDecisionPath } from './invitations.js';
import { buildApiHeaders } from './httpHeaders.js';
const state={token:localStorage.getItem('directory_token'),homes:[],selectedHome:null};
const q=(selector)=>document.querySelector(selector); const notice=(message)=>q('#notice').textContent=message==='EMAIL_NOT_VERIFIED'?'Verifica tu correo: revisa el enlace enviado a tu email antes de continuar.':message;
async function api(path,options={}){const headers=buildApiHeaders(Boolean(options.body),state.token);const response=await fetch(path,{...options,headers});if(response.status===204)return null;const body=await response.json();if(!response.ok)throw new Error(body.error||'REQUEST_FAILED');return body;}
function setTab(tab){q('#login').hidden=tab!=='login';q('#register').hidden=tab!=='register';const recoveryForm=q('#password-reset-request');if(recoveryForm)recoveryForm.hidden=tab!=='login';document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));}
function enterHomeFromSelector(home){ enterHome(home.id); }
async function loadHomes(){state.homes=await api('/directory/homes');q('#auth').hidden=true;q('#homes').hidden=false;q('#logout').hidden=false;const list=q('#home-list');list.innerHTML='';if(!state.homes.length){list.innerHTML='<p>Aún no tienes casas registradas.</p>';return;}for(const home of state.homes){const article=document.createElement('article');article.className='home-card';article.innerHTML=`<div><h2>${escapeHtml(home.name)}</h2><small>${home.role==='owner'?'Propietario':'Miembro'}</small></div><button>Entrar</button>`;article.querySelector('button').onclick=()=>enterHomeFromSelector(home);article.querySelector('div').onclick=()=>selectHome(home);list.append(article);}}
async function selectHome(home){state.selectedHome=home;q('#owner-panel').hidden=home.role!=='owner';q('#invite-result').textContent='';if(home.role!=='owner')return;const members=await api(`/directory/homes/${home.id}/memberships`);const list=q('#member-list');list.innerHTML=members.map(member=>`<div class="member"><span>${escapeHtml(member.displayName)} · ${escapeHtml(member.email)} · ${member.status}</span>${member.role==='member'&&member.status!=='revoked'?`<button data-account="${member.accountId}">Revocar</button>`:''}</div>`).join('');list.querySelectorAll('button[data-account]').forEach(button=>button.onclick=async()=>{try{await api(`/directory/homes/${home.id}/memberships/${button.dataset.account}`,{method:'DELETE'});await selectHome(home);notice('Acceso revocado.');}catch(error){notice(error.message);}});}
q('#login').onsubmit=async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));try{const result=await api('/directory/session',{method:'POST',body:JSON.stringify(data)});state.token=result.token;localStorage.setItem('directory_token',result.token);await loadHomes();}catch(error){notice(error.message);}};
q('#register').onsubmit=async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));try{await api('/directory/accounts',{method:'POST',body:JSON.stringify(data)});setTab('login');notice('Cuenta creada. Ahora inicia sesión.');}catch(error){notice(error.message);}};
q('#new-home').onclick=()=>q('#home-form').hidden=!q('#home-form').hidden;
q('#home-form').onsubmit=async(event)=>{event.preventDefault();const form=event.currentTarget;try{await api('/directory/homes',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();form.hidden=true;await loadHomes();notice('Casa registrada.');}catch(error){notice(error.message);}};
async function respondToInvitation(decision) {
  const form = q('#invitation-response');
  const token = new FormData(form).get('token');
  if (typeof token !== 'string' || !token) return;
  try {
    await api(invitationDecisionPath(token, decision), { method: 'POST' });
    form.reset();
    await loadHomes();
    notice(decision === 'accept' ? 'Invitación aceptada.' : 'Invitación rechazada.');
  } catch (error) {
    notice(error.message);
  }
}q('#invitation-response').onsubmit=async(event)=>{event.preventDefault();await respondToInvitation('accept');};
q('#reject-invitation').onclick=()=>respondToInvitation('reject');
q('#invite-form').onsubmit=async(event)=>{event.preventDefault();if(!state.selectedHome)return;const form=event.currentTarget;try{const invitation=await api(`/directory/homes/${state.selectedHome.id}/invitations`,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});q('#invite-result').textContent=`Invitación creada. Token para entregar de forma segura: ${invitation.token}`;form.reset();await selectHome(state.selectedHome);}catch(error){notice(error.message);}};
q('#pair-edge').onclick=async()=>{if(!state.selectedHome||state.selectedHome.role!=='owner')return;const output=q('#edge-credential');output.textContent='Generando código seguro…';try{const connection=await api(`/directory/homes/${state.selectedHome.id}/edge-pairing-code`,{method:'POST'});output.textContent=`C�digo: ${connection.code}\nVence: ${new Date(connection.expiresAt).toLocaleString()}\nIngresa o escanea este c�digo en la MiniPC.`;notice('Comparte �nicamente este c�digo con el instalador.');}catch(error){output.textContent='';notice(error.message);}};q('#logout').onclick=()=>{localStorage.removeItem('directory_token');state.token=null;state.selectedHome=null;q('#homes').hidden=true;q('#auth').hidden=false;q('#logout').hidden=true;};document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>setTab(button.dataset.tab));
const escapeHtml=(value)=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const homeRoute = window.location.pathname.match(/^\/homes\/([^/]+)$/);
if(state.token&&!homeRoute)loadHomes().catch(()=>q('#logout').click());

const query = new URLSearchParams(window.location.search);
const recovery = document.createElement('form');
recovery.id = 'password-reset-request';
recovery.innerHTML = '<label>Recuperar contrasena<input name="email" type="email" required></label><button>Enviar enlace de recuperacion</button>';
q('#login').insertAdjacentElement('afterend', recovery);
recovery.onsubmit = async event => {
  event.preventDefault();
  try {
    await api('/directory/password-reset/request', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(recovery))) });
    recovery.reset();
    notice('Si existe una cuenta, enviamos un enlace de recuperacion.');
  } catch (error) { notice(error.message); }
};

if (query.has('verify')) {
  api(`/directory/accounts/verify-email/${encodeURIComponent(query.get('verify'))}`, { method: 'POST' })
    .then(() => notice('Correo verificado. Ya puedes continuar.'))
    .catch(error => notice(error.message));
}
if (query.has('reset')) {
  q('#auth').hidden = false;
  const reset = document.createElement('form');
  reset.id = 'password-reset-confirm';
  reset.innerHTML = '<label>Nueva contrasena<input name="password" type="password" minlength="8" required></label><button>Guardar nueva contrasena</button>';
  recovery.insertAdjacentElement('afterend', reset);
  reset.onsubmit = async event => {
    event.preventDefault();
    try {
      await api(`/directory/password-reset/${encodeURIComponent(query.get('reset'))}/confirm`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(reset))) });
      reset.remove();
      history.replaceState({}, '', '/');
      notice('Contrasena actualizada. Ahora puedes ingresar.');
    } catch (error) { notice(error.message); }
  };
}

if (homeRoute) {
  const homeId = decodeURIComponent(homeRoute[1]);
  q('#auth').hidden = true;
  q('#homes').hidden = false;
  q('#logout').hidden = false;
  q('#home-list').innerHTML = '<section id="cloud-home"><h2>Mi hogar</h2><p id="cloud-home-status">Conectando con tu hogar…</p><div id="cloud-dashboards"></div><div id="cloud-devices"></div></section>';
  const render = (payload) => {
    const dashboards = Array.isArray(payload?.dashboards) ? payload.dashboards : [];
    const devices = Array.isArray(payload?.devices) ? payload.devices : [];
    q('#cloud-dashboards').innerHTML = dashboards.map(item => `<article><h3>${escapeHtml(item.title)}</h3><p>${(item.tabs || []).map(tab => escapeHtml(tab.title)).join(' · ')}</p></article>`).join('');
    q('#cloud-devices').innerHTML = devices.map(item => `<article><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.type)} · ${item.isOnline ? 'Disponible' : 'Sin conexión'}</p></article>`).join('');
  };
  Promise.all([api(`/homes/${encodeURIComponent(homeId)}/gateway/dashboard.read`, { method: 'POST' }), api(`/homes/${encodeURIComponent(homeId)}/gateway/devices.read`, { method: 'POST' })])
    .then(([dashboards, devices]) => { render({ dashboards: dashboards.payload?.dashboards, devices: devices.payload?.devices }); q('#cloud-home-status').textContent = 'Hogar conectado.'; })
    .catch(error => { q('#cloud-home-status').textContent = error.message === 'EDGE_OFFLINE' ? 'Tu hogar está temporalmente sin conexión. El control local sigue disponible.' : 'No fue posible cargar este hogar.'; });
}