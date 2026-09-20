"use strict";

/* Hosted co-op client. The local Node runtime deliberately does not load the
   static-runtime marker, so this feature stays out of TierForge.cmd. */
window.collaboration=(()=>{
  const hosted=()=>!!document.querySelector('meta[name="tierforge-runtime"][content="static"]');
  const clone=value=>structuredClone(value);
  const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
  let booted=false;
  const state={active:false,connected:false,code:'',participantId:'',token:'',hostId:'',
    participants:new Map(),baseBoard:null,inflight:null,saved:false,intentionalClose:false,
    reconnectUntil:0,reconnectTimer:null,lastPointer:{x:null,y:null},remote:new Map()};

  function shareableImage(value){
    if(typeof value!=='string'||!value)return '';
    if(/^https?:\/\//i.test(value))return value;
    const path=value.replace(/^\.?\//,'');
    return path.startsWith('Images/catalogs/')?path:'';
  }
  function sharedBoard(board){
    const result=clone(board); let removed=0;
    Object.values(result.items||{}).forEach(item=>{
      ['img','fallbackImg','remoteFallbackImg','localImg'].forEach(field=>{
        if(!(field in item))return;
        const image=shareableImage(item[field]);
        if(image)item[field]=image;
        else{ delete item[field]; removed++; }
      });
    });
    return {board:result,removed};
  }
  function isObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
  function diffValues(before,after,path=[],operations=[]){
    if(equal(before,after))return operations;
    if(Array.isArray(before)&&Array.isArray(after)){
      const keyed=list=>list.length>0&&list.every(value=>isObject(value)&&typeof value.id==='string')&&
        new Set(list.map(value=>value.id)).size===list.length;
      if(keyed(before)&&keyed(after)&&before.length===after.length&&
          before.every((value,index)=>value.id===after[index].id)){
        before.forEach((value,index)=>diffValues(value,after[index],[...path,index],operations));
        return operations;
      }
    }else if(isObject(before)&&isObject(after)){
      const keys=new Set([...Object.keys(before),...Object.keys(after)]);
      for(const key of keys){
        const beforeExists=Object.prototype.hasOwnProperty.call(before,key);
        const afterExists=Object.prototype.hasOwnProperty.call(after,key);
        if(beforeExists&&afterExists)diffValues(before[key],after[key],[...path,key],operations);
        else operations.push({path:[...path,key],beforeExists,afterExists,
          ...(beforeExists?{before:clone(before[key])}:{}),...(afterExists?{after:clone(after[key])}:{})});
      }
      return operations;
    }
    operations.push({path,beforeExists:true,afterExists:true,before:clone(before),after:clone(after)});
    return operations;
  }
  function pathValue(root,path){
    let value=root;
    for(const part of path){
      if(value===null||typeof value!=='object'||!(part in value))return {exists:false};
      value=value[part];
    }
    return {exists:true,value};
  }
  function setPath(root,path,exists,value){
    let target=root;
    for(let index=0;index<path.length-1;index+=1){
      if(target===null||typeof target!=='object'||!(path[index] in target))return false;
      target=target[path[index]];
    }
    const key=path.at(-1);
    if(exists)target[key]=clone(value);
    else if(Array.isArray(target))target.splice(Number(key),1);
    else delete target[key];
    return true;
  }
  function applyOperations(board,operations){
    let applied=0,skipped=0;
    for(const operation of operations){
      const current=pathValue(board,operation.path);
      if(current.exists===operation.beforeExists&&(!current.exists||equal(current.value,operation.before))&&
          setPath(board,operation.path,operation.afterExists,operation.after))applied++;
      else skipped++;
    }
    return {applied,skipped};
  }
  function actionId(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;}
  function send(message){
    if(state.connected&&state.socket?.readyState===WebSocket.OPEN)state.socket.send(JSON.stringify(message));
  }

  function setConnection(connected){
    state.connected=connected;
    document.body.classList.toggle('collab-readonly',state.active&&!connected);
    $('#coopConnection').hidden=!state.active||connected;
    renderCoopUi();
  }
  function participant(){return state.participants.get(state.participantId);}
  function isHost(){return state.hostId===state.participantId;}
  function inviteUrl(){
    const url=new URL(location.href); url.searchParams.set('session',state.code); return url.toString();
  }
  function rememberCredentials(){
    sessionStorage.setItem(`tierforge:session:${state.code}`,JSON.stringify({
      participantId:state.participantId,token:state.token,
    }));
  }
  function forgetCredentials(){
    sessionStorage.removeItem(`tierforge:session:${state.code}`);
  }
  function setSessionUrl(code){
    const url=new URL(location.href);
    if(code)url.searchParams.set('session',code); else url.searchParams.delete('session');
    history.replaceState(null,'',url);
  }

  function renderCoopUi(){
    const active=state.active;
    $('#coopIdle').hidden=active;
    $('#coopActive').hidden=!active;
    $('#coopSave').hidden=!active;
    $('#coopLeave').hidden=!active;
    $('#coopEnd').hidden=!active||!isHost();
    $('#btnAddImgs').disabled=active;
    $('#btnAddImgs').title=active?'Local images are unavailable in co-op sessions':'Add images';
    if($('#btnImageFolder'))$('#btnImageFolder').disabled=active;
    $('#coopRoomCode').textContent=state.code;
    const own=participant();
    if(active&&own&&document.activeElement!==$('#coopName'))$('#coopName').value=own.name;
    const members=$('#coopMembers');
    members.replaceChildren(...[...state.participants.values()].map(member=>{
      const row=document.createElement('div'); row.className='coop-member';
      row.innerHTML=`<i style="--member-color:${esc(member.color)}"></i><span>${esc(member.name)}</span>`+
        (member.id===state.hostId?'<b>Host</b>':'')+(!member.connected?'<small>Reconnecting</small>':'');
      return row;
    }));
    const presence=$('#coopPresence'); presence.hidden=!active;
    if(active){
      presence.replaceChildren(...[...state.participants.values()].map(member=>{
        const dot=document.createElement('span'); dot.className='coop-presence-dot';
        dot.style.setProperty('--member-color',member.color); dot.title=`${member.name}${member.id===state.hostId?' (Host)':''}`;
        dot.classList.toggle('offline',!member.connected); return dot;
      }));
      const label=document.createElement('button'); label.type='button'; label.textContent=state.connected?state.code:'Reconnecting…';
      label.onclick=()=>dlgCoop.showModal(); presence.appendChild(label);
    }
  }
  function updatePresence(message){
    state.hostId=message.hostId;
    state.participants=new Map((message.participants||[]).map(member=>[member.id,member]));
    for(const id of state.remote.keys())if(!state.participants.has(id))state.remote.delete(id);
    renderCoopUi(); renderRemotePresence();
  }

  function applyServerBoard(board){
    S=clone(board); prepareState(); sel.clear(); lastClicked=null; closeInsp(); render();
  }
  function receiveState(message){
    if(state.inflight&&message.actionId===state.inflight.id){
      const current=sharedBoard(S).board;
      const queued=diffValues(state.inflight.sentBoard,current);
      state.baseBoard=clone(message.board);
      const rebased=clone(message.board), result=applyOperations(rebased,queued);
      state.inflight=null;
      applyServerBoard(rebased);
      if(result.skipped)toast(`${result.skipped} newer change${result.skipped===1?' was':'s were'} kept`);
      if(message.undo?.skipped)toast(`Undone with ${message.undo.skipped} conflicting change${message.undo.skipped===1?'':'s'} kept`);
      sendPending(); return;
    }
    if(state.inflight)return; // The authoritative response to our queued action follows in order.
    state.baseBoard=clone(message.board); applyServerBoard(message.board);
    if(message.undo?.skipped)toast(`Undone with ${message.undo.skipped} conflicting change${message.undo.skipped===1?'':'s'} kept`);
  }
  function receiveConflict(message){
    if(!state.inflight||message.actionId!==state.inflight.id)return;
    const desired=sharedBoard(S).board;
    const localChanges=diffValues(state.inflight.baseBoard,desired);
    state.baseBoard=clone(message.board);
    const rebased=clone(message.board), result=applyOperations(rebased,localChanges);
    state.inflight=null;
    applyServerBoard(rebased);
    toast(result.skipped?'A conflicting newer edit was kept':'Changes resynchronized');
    sendPending();
  }

  function onMessage(event){
    let message; try{message=JSON.parse(event.data);}catch{return;}
    if(message.type==='welcome'){
      state.active=true; state.reconnectUntil=Date.now()+60_000;
      state.baseBoard=clone(message.board); state.inflight=null;
      updatePresence(message); applyServerBoard(message.board); setConnection(true);
      setSessionUrl(state.code); rememberCredentials(); $('#dlgCoop').open&&dlgCoop.close();
      toast(`Joined co-op room ${state.code}`); return;
    }
    if(message.type==='presence'){updatePresence(message);return;}
    if(message.type==='cursor'){
      if(message.participantId!==state.participantId){
        state.remote.set(message.participantId,{x:message.x,y:message.y,selection:message.selection||[]});
        renderRemotePresence();
      }
      return;
    }
    if(message.type==='state'){receiveState(message);return;}
    if(message.type==='conflict'){receiveConflict(message);return;}
    if(message.type==='undo-result'){toast(message.message||'Nothing to undo');return;}
    if(message.type==='error'){toast(message.error||'Co-op error');return;}
    if(message.type==='ended'){
      toast(message.reason||'The co-op session ended'); state.intentionalClose=true; state.socket?.close();
      leaveLocal(false); return;
    }
  }
  function connect(){
    clearTimeout(state.reconnectTimer);
    const protocol=location.protocol==='https:'?'wss:':'ws:';
    const url=`${protocol}//${location.host}/api/sessions/${state.code}/connect?`+
      new URLSearchParams({participant:state.participantId,token:state.token});
    const socket=new WebSocket(url); state.socket=socket;
    socket.onmessage=onMessage;
    socket.onopen=()=>{state.reconnectUntil=Date.now()+60_000;};
    socket.onclose=()=>{
      if(state.socket!==socket||state.intentionalClose)return;
      const wasConnected=state.connected;
      if(wasConnected)state.reconnectUntil=Date.now()+60_000;
      setConnection(false);
      if(Date.now()<state.reconnectUntil){
        state.reconnectTimer=setTimeout(connect,1200);
      }else{
        toast('Could not reconnect to the co-op session'); leaveLocal(false);
      }
    };
    socket.onerror=()=>socket.close();
  }
  function beginConnection(code,credentials){
    state.active=true; state.intentionalClose=false; state.code=code;
    state.participantId=credentials.participantId; state.token=credentials.token;
    state.saved=false; state.reconnectUntil=Date.now()+60_000;
    setConnection(false); renderCoopUi(); connect();
  }
  async function request(path,body){
    const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);
    return result;
  }
  function setError(error){
    const box=$('#coopError'); box.hidden=!error; box.textContent=error||'';
  }
  async function start(){
    const button=$('#coopStart'); button.disabled=true; setError('');
    try{
      storeActiveSubBoard();
      const prepared=sharedBoard(S);
      const result=await request('/api/sessions',{board:prepared.board,name:$('#coopName').value});
      if(prepared.removed)toast(`${prepared.removed} local image reference${prepared.removed===1?'':'s'} replaced with placeholders`);
      beginConnection(result.code,result);
    }catch(error){setError(error.message);}finally{button.disabled=false;}
  }
  async function join(){
    const code=$('#coopCode').value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8);
    if(code.length!==8)return setError('Enter the eight-character room code.');
    const button=$('#coopJoin'); button.disabled=true; setError('');
    try{beginConnection(code,await request(`/api/sessions/${code}/join`,{name:$('#coopName').value}));}
    catch(error){setError(error.message);}finally{button.disabled=false;}
  }

  function sendPending(){
    if(!state.active||!state.connected||state.inflight)return;
    const target=sharedBoard(S).board;
    const operations=diffValues(state.baseBoard,target);
    if(!operations.length)return;
    const id=actionId();
    state.inflight={id,baseBoard:clone(state.baseBoard),sentBoard:clone(target)};
    send({type:'patch',actionId:id,operations});
  }
  function handlePersist(){
    if(!state.active)return false;
    if(!state.connected){
      applyServerBoard(state.baseBoard); toast('Shared editing is paused while reconnecting'); return true;
    }
    state.saved=false; sendPending(); return true;
  }
  function undoRemote(){
    if(!state.active)return false;
    if(!state.connected)return toast('Shared editing is paused while reconnecting'),true;
    send({type:'undo',actionId:actionId()}); return true;
  }

  function selectionChanged(){
    if(!state.active||!state.connected)return;
    send({type:'cursor',x:state.lastPointer.x,y:state.lastPointer.y,selection:[...sel]});
  }
  function pointerMoved(event){
    if(!state.active||!state.connected)return;
    const canvas=$('#canvas'),rect=canvas.getBoundingClientRect();
    state.lastPointer={x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};
    if(pointerMoved.pending)return;
    pointerMoved.pending=true;
    setTimeout(()=>{pointerMoved.pending=false;selectionChanged();},35);
  }
  function pointerLeft(){
    if(!state.active)return;
    state.lastPointer={x:null,y:null}; selectionChanged();
  }
  function renderRemotePresence(){
    $$('.remote-selection').forEach(element=>element.remove());
    $('#coopCursors').replaceChildren();
    const canvas=$('#canvas'),rect=canvas.getBoundingClientRect();
    let selectionLayer=0;
    for(const [id,remote] of state.remote){
      const member=state.participants.get(id); if(!member?.connected)continue;
      (remote.selection||[]).forEach(itemId=>{
        const item=$(`.item[data-id="${CSS.escape(itemId)}"]`); if(!item)return;
        const marker=document.createElement('i'); marker.className='remote-selection';
        marker.style.setProperty('--remote-color',member.color); marker.style.setProperty('--remote-inset',`${selectionLayer%3*3}px`);
        marker.title=`Selected by ${member.name}`; item.appendChild(marker);
      });
      selectionLayer++;
      if(remote.x===null||remote.y===null||!Number.isFinite(remote.x)||!Number.isFinite(remote.y))continue;
      const cursor=document.createElement('div'); cursor.className='remote-cursor';
      cursor.style.left=`${rect.left+remote.x*rect.width}px`; cursor.style.top=`${rect.top+remote.y*rect.height}px`;
      cursor.style.setProperty('--remote-color',member.color);
      cursor.innerHTML='<b></b><span></span>'; cursor.querySelector('span').textContent=member.name;
      $('#coopCursors').appendChild(cursor);
    }
  }
  function afterRender(){if(state.active)requestAnimationFrame(renderRemotePresence);}

  async function saveCopy(){
    storeActiveSubBoard();
    const ok=await saveBoard(S.title||'Board');
    if(ok){state.saved=true;toast(`Saved board "${S.title||'Board'}"`);}else toast('Could not save this board');
    return ok;
  }
  function leaveLocal(closeSocket=true){
    if(closeSocket){state.intentionalClose=true;state.socket?.close(1000,'Left session');}
    clearTimeout(state.reconnectTimer); forgetCredentials(); setSessionUrl('');
    state.active=false;state.connected=false;state.code='';state.participantId='';state.token='';
    state.hostId='';state.participants.clear();state.remote.clear();state.baseBoard=null;state.inflight=null;
    document.body.classList.remove('collab-readonly'); $('#coopConnection').hidden=true;
    $('#coopPresence').hidden=true; $('#coopCursors').replaceChildren(); renderCoopUi(); render();
  }
  function leave(){
    if(!state.saved&&!confirm('Leave this temporary session without saving a local copy?'))return;
    leaveLocal(); if($('#dlgCoop').open)dlgCoop.close();
  }
  function endSession(){send({type:'end'});dlgCoopEnd.close();}

  async function boot(){
    if(booted||!hosted())return;
    booted=true;
    $('#btnCoop').hidden=false;
    $('#btnCoop').onclick=()=>{renderCoopUi();dlgCoop.showModal();};
    $('#coopClose').onclick=()=>dlgCoop.close();
    $('#coopStart').onclick=start; $('#coopJoin').onclick=join;
    $('#coopCode').oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8);
    $('#coopCode').onkeydown=e=>{if(e.key==='Enter')join();};
    $('#coopName').onchange=e=>{if(state.active)send({type:'rename',name:e.target.value});};
    $('#coopCopyLink').onclick=async()=>{
      try{await navigator.clipboard.writeText(inviteUrl());toast('Invite link copied');}
      catch{prompt('Copy this invite link:',inviteUrl());}
    };
    $('#coopSave').onclick=saveCopy; $('#coopLeave').onclick=leave;
    $('#coopEnd').onclick=()=>dlgCoopEnd.showModal();
    $('#coopEndCancel').onclick=()=>dlgCoopEnd.close();
    $('#coopEndWithout').onclick=endSession;
    $('#coopSaveEnd').onclick=async()=>{if(await saveCopy())endSession();};
    $('#canvas').addEventListener('pointermove',pointerMoved);
    $('#canvas').addEventListener('pointerleave',pointerLeft);
    window.addEventListener('resize',renderRemotePresence);
    const code=new URL(location.href).searchParams.get('session')?.toUpperCase();
    if(code&&/^[A-Z2-9]{8}$/.test(code)){
      $('#coopCode').value=code;
      let credentials=null;
      try{credentials=JSON.parse(sessionStorage.getItem(`tierforge:session:${code}`)||'null');}catch{}
      if(credentials?.participantId&&credentials?.token)beginConnection(code,credentials);
      else dlgCoop.showModal();
    }
  }
  return {boot,handlePersist,undo:undoRemote,selectionChanged,afterRender,isActive:()=>state.active,
    isConnected:()=>state.connected};
})();
window.collaboration.boot();
