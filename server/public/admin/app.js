(() => {
  const loginScreen = document.getElementById("loginScreen");
  const loginForm = document.getElementById("loginForm");
  const passwordInput = document.getElementById("passwordInput");
  const loginError = document.getElementById("loginError");
  const dashboard = document.getElementById("dashboard");
  const wsStatus = document.getElementById("wsStatus");
  const logoutBtn = document.getElementById("logoutBtn");
  const createChannelForm = document.getElementById("createChannelForm");
  const newChannelName = document.getElementById("newChannelName");
  const channelsList = document.getElementById("channelsList");
  const activityList = document.getElementById("activityList");

  const pttName = document.getElementById("pttName");
  const pttChannelSelect = document.getElementById("pttChannelSelect");
  const pttConnectBtn = document.getElementById("pttConnectBtn");
  const pttDisconnectBtn = document.getElementById("pttDisconnectBtn");
  const pttStatus = document.getElementById("pttStatus");
  const pttTalkBtn = document.getElementById("pttTalkBtn");
  const pttEndCallBtn = document.getElementById("pttEndCallBtn");

  const createUserForm = document.getElementById("createUserForm");
  const newUsername = document.getElementById("newUsername");
  const newUserPassword = document.getElementById("newUserPassword");
  const newUserChannel = document.getElementById("newUserChannel");
  const usersList = document.getElementById("usersList");

  const toastContainer = document.getElementById("toastContainer");
  const confirmOverlay = document.getElementById("confirmOverlay");
  const confirmMessage = document.getElementById("confirmMessage");
  const confirmOkBtn = document.getElementById("confirmOkBtn");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");

  const editUserOverlay = document.getElementById("editUserOverlay");
  const editUserTitle = document.getElementById("editUserTitle");
  const editUserPassword = document.getElementById("editUserPassword");
  const editUserChannel = document.getElementById("editUserChannel");
  const editUserSaveBtn = document.getElementById("editUserSaveBtn");
  const editUserCancelBtn = document.getElementById("editUserCancelBtn");

  const tabButtons = [...document.querySelectorAll(".tab-btn")];
  const tabPanels = {
    talk: document.getElementById("tab-talk"),
    users: document.getElementById("tab-users"),
    channels: document.getElementById("tab-channels"),
  };

  let password = sessionStorage.getItem("ptt_admin_password") || "";
  let ws = null;
  let reconnectTimer = null;
  let knownChannels = [];
  let cachedUsers = [];

  for (const btn of tabButtons) {
    btn.addEventListener("click", () => {
      for (const b of tabButtons) b.classList.toggle("active", b === btn);
      for (const key of Object.keys(tabPanels)) tabPanels[key].hidden = key !== btn.dataset.tab;
    });
  }

  function syncChannelSelectOptions(select, selected) {
    if (!select) return;
    const previous = selected !== undefined ? selected : select.value;
    select.innerHTML = "";
    for (const name of knownChannels) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
    if (previous && knownChannels.includes(previous)) select.value = previous;
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = "toast" + (type === "error" ? " toast-error" : type === "success" ? " toast-success" : "");
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("toast-leaving");
      setTimeout(() => toast.remove(), 260);
    }, 4200);
  }

  function showConfirm(message) {
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmOverlay.hidden = false;
      const cleanup = (result) => {
        confirmOverlay.hidden = true;
        confirmOkBtn.removeEventListener("click", onOk);
        confirmCancelBtn.removeEventListener("click", onCancel);
        resolve(result);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      confirmOkBtn.addEventListener("click", onOk);
      confirmCancelBtn.addEventListener("click", onCancel);
    });
  }

  function apiFetch(path, options = {}) {
    return fetch(`/admin/api${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
        ...(options.headers || {}),
      },
    });
  }

  async function tryLogin(pw) {
    password = pw;
    const res = await apiFetch("/state");
    if (res.status === 401) {
      password = "";
      return false;
    }
    sessionStorage.setItem("ptt_admin_password", pw);
    showDashboard();
    return true;
  }

  function showDashboard() {
    loginScreen.hidden = true;
    dashboard.hidden = false;
    connectWs();
    refreshUsers();
  }

  function showLogin(message) {
    dashboard.hidden = true;
    loginScreen.hidden = false;
    if (message) {
      loginError.textContent = message;
      loginError.hidden = false;
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const ok = await tryLogin(passwordInput.value);
    if (!ok) {
      loginError.textContent = "Senha incorreta.";
      loginError.hidden = false;
    }
  });

  logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem("ptt_admin_password");
    password = "";
    if (ws) ws.close();
    showLogin();
  });

  createChannelForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = newChannelName.value.trim();
    if (!name) return;
    const res = await apiFetch("/channels", {
      method: "POST",
      body: JSON.stringify({ action: "create", name }),
    });
    if (res.ok) {
      newChannelName.value = "";
      showToast("Canal criado.", "success");
    } else {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || "Erro ao criar canal", "error");
    }
  });

  async function refreshUsers() {
    const res = await apiFetch("/users");
    if (!res.ok) return;
    const body = await res.json();
    cachedUsers = body.users || [];
    renderUsers(cachedUsers);
  }

  function renderUsers(users) {
    usersList.innerHTML = "";
    if (users.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-hint";
      li.textContent = "Nenhum usuário cadastrado ainda";
      usersList.appendChild(li);
      return;
    }
    for (const user of users) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = user.defaultChannel ? `${user.username} — ${user.defaultChannel}` : user.username;

      const actions = document.createElement("div");
      actions.className = "actions";

      const editBtn = document.createElement("button");
      editBtn.className = "secondary";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", () => openEditUser(user));
      actions.appendChild(editBtn);

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "Remover";
      removeBtn.addEventListener("click", async () => {
        if (!(await showConfirm(`Remover o usuário "${user.username}"?`))) return;
        const res = await apiFetch(`/users/${encodeURIComponent(user.username)}`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          showToast(body.error || "Erro ao remover usuário", "error");
          return;
        }
        showToast("Usuário removido.", "success");
        refreshUsers();
      });
      actions.appendChild(removeBtn);

      li.append(label, actions);
      usersList.appendChild(li);
    }
  }

  function openEditUser(user) {
    editUserTitle.textContent = `Editar "${user.username}"`;
    editUserPassword.value = "";
    syncChannelSelectOptions(editUserChannel, user.defaultChannel || knownChannels[0]);
    editUserOverlay.hidden = false;

    const onSave = async () => {
      const changes = { defaultChannel: editUserChannel.value };
      if (editUserPassword.value) changes.password = editUserPassword.value;
      const res = await apiFetch(`/users/${encodeURIComponent(user.username)}`, {
        method: "PUT",
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body.error || "Erro ao salvar usuário", "error");
        return;
      }
      showToast("Usuário atualizado.", "success");
      cleanup();
      refreshUsers();
    };
    const onCancel = () => cleanup();
    function cleanup() {
      editUserOverlay.hidden = true;
      editUserSaveBtn.removeEventListener("click", onSave);
      editUserCancelBtn.removeEventListener("click", onCancel);
    }
    editUserSaveBtn.addEventListener("click", onSave);
    editUserCancelBtn.addEventListener("click", onCancel);
  }

  createUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = newUsername.value.trim();
    const pw = newUserPassword.value;
    if (!username || !pw) return;
    const res = await apiFetch("/users", {
      method: "POST",
      body: JSON.stringify({ username, password: pw, defaultChannel: newUserChannel.value || null }),
    });
    if (res.ok) {
      newUsername.value = "";
      newUserPassword.value = "";
      showToast("Usuário criado.", "success");
      refreshUsers();
    } else {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || "Erro ao criar usuário", "error");
    }
  });

  function connectWs() {
    if (ws) ws.close();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/admin-ws?password=${encodeURIComponent(password)}`);

    ws.onopen = () => {
      wsStatus.textContent = "conectado";
      wsStatus.className = "status-badge status-connected";
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      const snapshot = JSON.parse(event.data);
      render(snapshot);
    };

    ws.onclose = (event) => {
      wsStatus.textContent = "desconectado";
      wsStatus.className = "status-badge status-disconnected";
      if (event.code === 4001) {
        showLogin("Sessão expirada, faça login novamente.");
        return;
      }
      reconnectTimer = setTimeout(connectWs, 2000);
    };

    ws.onerror = () => ws.close();
  }

  function render(snapshot) {
    knownChannels = snapshot.channels.map((c) => c.name);

    channelsList.innerHTML = "";
    for (const channel of snapshot.channels) {
      channelsList.appendChild(renderChannelCard(channel));
    }

    syncPttChannelOptions();
    syncChannelSelectOptions(newUserChannel);

    activityList.innerHTML = "";
    for (const entry of snapshot.recentActivity) {
      const li = document.createElement("li");
      const time = new Date(entry.time).toLocaleTimeString("pt-BR");
      if (entry.action === "start") {
        li.textContent = `${time} — ${entry.userName} começou a falar em "${entry.channel}"`;
      } else {
        const dur = entry.durationMs != null ? ` (${(entry.durationMs / 1000).toFixed(1)}s)` : "";
        li.textContent = `${time} — ${entry.userName} parou de falar em "${entry.channel}"${dur}`;
      }
      activityList.appendChild(li);
    }
  }

  function renderChannelCard(channel) {
    const card = document.createElement("div");
    card.className = "channel-card";

    const header = document.createElement("div");
    header.className = "channel-card-header";

    const nameForm = document.createElement("form");
    nameForm.className = "name-form";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = channel.name;
    const renameBtn = document.createElement("button");
    renameBtn.type = "submit";
    renameBtn.textContent = "Renomear";
    nameForm.append(nameInput, renameBtn);
    nameForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newName = nameInput.value.trim();
      if (!newName || newName === channel.name) return;
      const res = await apiFetch("/channels", {
        method: "POST",
        body: JSON.stringify({ action: "rename", name: channel.name, newName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body.error || "Erro ao renomear canal", "error");
      } else {
        showToast("Canal renomeado.", "success");
      }
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "danger";
    removeBtn.textContent = "Remover";
    removeBtn.addEventListener("click", async () => {
      if (!(await showConfirm(`Remover o canal "${channel.name}"? Os usuários conectados serão desconectados dele.`))) return;
      const res = await apiFetch("/channels", {
        method: "POST",
        body: JSON.stringify({ action: "remove", name: channel.name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body.error || "Erro ao remover canal", "error");
      }
    });

    header.append(nameForm, removeBtn);
    card.appendChild(header);

    if (channel.users.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "Nenhum coletor neste canal";
      card.appendChild(hint);
    }

    for (const user of channel.users) {
      const row = document.createElement("div");
      row.className = "user-row";

      const label = document.createElement("span");
      label.textContent = user.name;
      if (user.id === channel.speaker) {
        label.textContent += " 🔊";
        label.className = "speaking";
      }

      const actions = document.createElement("div");
      actions.className = "actions";

      const moveSelect = document.createElement("select");
      moveSelect.className = "move-select";
      moveSelect.title = "Mover para outro canal";
      for (const name of knownChannels) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        moveSelect.appendChild(opt);
      }
      moveSelect.value = channel.name;
      moveSelect.addEventListener("change", async () => {
        const target = moveSelect.value;
        const res = await apiFetch("/move-user", {
          method: "POST",
          body: JSON.stringify({ clientId: user.id, channel: target }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          showToast(body.error || "Erro ao mover coletor de canal", "error");
          moveSelect.value = channel.name;
        } else {
          showToast(`${user.name} movido para "${target}".`, "success");
        }
      });
      actions.appendChild(moveSelect);

      if (user.id !== pttMyClientId) {
        const callBtn = document.createElement("button");
        callBtn.className = "btn-call";
        callBtn.textContent = "Ligar";
        callBtn.addEventListener("click", () => startCallWith(user.id));
        actions.appendChild(callBtn);
      }

      const kickBtn = document.createElement("button");
      kickBtn.textContent = "Expulsar";
      kickBtn.addEventListener("click", async () => {
        const res = await apiFetch("/kick", {
          method: "POST",
          body: JSON.stringify({ clientId: user.id }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          showToast(body.error || "Erro ao expulsar coletor", "error");
        } else {
          showToast("Coletor expulso.", "success");
        }
      });
      actions.appendChild(kickBtn);

      row.append(label, actions);
      card.appendChild(row);
    }

    return card;
  }

  // ---- Falar/ouvir pelo navegador: conecta como mais um "coletor", reaproveitando
  // o mesmo protocolo de dispositivo (hello/join/ptt_start/ptt_stop + áudio binário). ----
  let pttWs = null;
  let audioCtx = null;
  let micStream = null;
  let micSource = null;
  let micProcessor = null;
  let pttTransmitting = false;
  let pttHeld = false;
  let pttMyClientId = null;
  let pttCurrentChannel = null;
  let nextPlayTime = 0;
  let pttInCall = false;
  let pttCallPeerName = null;

  function startCallWith(targetId) {
    if (!pttWs || pttWs.readyState !== WebSocket.OPEN) {
      showToast('Conecte o áudio ("Conectar áudio") antes de ligar para alguém.', "error");
      return;
    }
    if (pttInCall) {
      showToast("Encerre a chamada atual antes de ligar para outra pessoa.", "error");
      return;
    }
    pttWs.send(JSON.stringify({ type: "call_start", targetId }));
  }

  function syncPttChannelOptions() {
    const previous = pttChannelSelect.value;
    pttChannelSelect.innerHTML = "";
    for (const name of knownChannels) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      pttChannelSelect.appendChild(opt);
    }
    if (knownChannels.includes(previous)) {
      pttChannelSelect.value = previous;
    } else if (pttCurrentChannel && knownChannels.includes(pttCurrentChannel)) {
      pttChannelSelect.value = pttCurrentChannel;
    }
  }

  function setPttStatus(text, cls) {
    pttStatus.textContent = text;
    pttStatus.className = "ptt-status" + (cls ? " " + cls : "");
  }

  function playPcmChunk(arrayBuffer) {
    if (!audioCtx) return;
    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    const buffer = audioCtx.createBuffer(1, float32.length, 16000);
    buffer.copyToChannel(float32, 0);
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    if (nextPlayTime < now + 0.05) nextPlayTime = now + 0.05;
    src.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  }

  function handlePttMessage(msg) {
    switch (msg.type) {
      case "welcome":
        pttMyClientId = msg.clientId;
        break;
      case "ptt_granted":
        pttTransmitting = true;
        if (!pttHeld) {
          // Botão já foi solto antes da confirmação do servidor chegar: libera na hora,
          // sem deixar o botão preso em "FALANDO...".
          stopTalk();
          break;
        }
        pttTalkBtn.classList.add("talking");
        pttTalkBtn.classList.remove("receiving");
        pttTalkBtn.textContent = "FALANDO…";
        break;
      case "ptt_denied":
        pttTalkBtn.classList.remove("talking");
        pttTalkBtn.textContent = "SEGURE PARA FALAR";
        setPttStatus("Canal ocupado, aguarde.", "");
        break;
      case "speaker_started":
        if (msg.speakerId !== pttMyClientId) {
          setPttStatus(`Falando: ${msg.speakerName}`, "receiving");
          pttTalkBtn.classList.add("receiving");
        }
        break;
      case "speaker_stopped":
        setPttStatus("Conectado.", "");
        pttTalkBtn.classList.remove("receiving", "talking");
        pttTalkBtn.textContent = "SEGURE PARA FALAR";
        break;
      case "channel_removed":
        if (msg.channel === pttCurrentChannel) {
          setPttStatus(`O canal "${msg.channel}" foi removido.`, "");
        }
        break;
      case "call_started":
        pttInCall = true;
        pttCallPeerName = msg.peerName;
        pttEndCallBtn.hidden = false;
        pttChannelSelect.disabled = true;
        setPttStatus(`Chamada individual com ${msg.peerName}.`, "receiving");
        break;
      case "call_ended":
        pttInCall = false;
        pttCallPeerName = null;
        pttEndCallBtn.hidden = true;
        pttChannelSelect.disabled = false;
        pttTalkBtn.classList.remove("talking", "receiving");
        pttTalkBtn.textContent = "SEGURE PARA FALAR";
        setPttStatus(
          msg.reason === "peer_disconnected" ? "A outra pessoa saiu da chamada." : "Chamada encerrada.",
          ""
        );
        break;
      case "call_denied":
        showToast(
          msg.reason === "already_in_call"
            ? "Essa pessoa já está em outra chamada."
            : msg.reason === "target_offline"
              ? "Essa pessoa não está mais online."
              : "Não foi possível ligar (usuário não encontrado).",
          "error"
        );
        break;
      case "error":
        setPttStatus(msg.message, "");
        break;
    }
  }

  function teardownPttAudio(closeSocket) {
    pttTransmitting = false;
    pttInCall = false;
    pttCallPeerName = null;
    pttEndCallBtn.hidden = true;
    pttChannelSelect.disabled = false;
    if (micProcessor) {
      micProcessor.disconnect();
      micProcessor.onaudioprocess = null;
      micProcessor = null;
    }
    if (micSource) {
      micSource.disconnect();
      micSource = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    if (closeSocket && pttWs) pttWs.close();
    pttWs = null;
    nextPlayTime = 0;
    pttConnectBtn.hidden = false;
    pttDisconnectBtn.hidden = true;
    pttTalkBtn.hidden = true;
    pttTalkBtn.classList.remove("talking", "receiving");
    pttTalkBtn.textContent = "SEGURE PARA FALAR";
  }

  async function connectPttAudio() {
    if (pttWs) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      showToast("Não foi possível acessar o microfone: " + err.message, "error");
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    micSource = audioCtx.createMediaStreamSource(micStream);
    micProcessor = audioCtx.createScriptProcessor(2048, 1, 1);
    micProcessor.onaudioprocess = (event) => {
      if (!pttTransmitting || !pttWs || pttWs.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm16[i] = s < 0 ? s * 32768 : s * 32767;
      }
      pttWs.send(pcm16.buffer);
    };
    micSource.connect(micProcessor);
    micProcessor.connect(audioCtx.destination);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    pttWs = new WebSocket(`${proto}://${location.host}/`);
    pttWs.binaryType = "arraybuffer";

    pttWs.onopen = () => {
      const name = pttName.value.trim() || "Administrador";
      pttWs.send(
        JSON.stringify({
          type: "hello",
          adminPassword: password,
          name,
          deviceId: `admin-web-${Math.random().toString(36).slice(2, 8)}`,
        })
      );
      pttCurrentChannel = pttChannelSelect.value || knownChannels[0] || null;
      if (pttCurrentChannel) {
        pttWs.send(JSON.stringify({ type: "join", channel: pttCurrentChannel }));
      }
      setPttStatus("Conectado.", "");
      pttConnectBtn.hidden = true;
      pttDisconnectBtn.hidden = false;
      pttTalkBtn.hidden = false;
    };

    pttWs.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playPcmChunk(event.data);
        return;
      }
      handlePttMessage(JSON.parse(event.data));
    };

    pttWs.onclose = () => {
      setPttStatus("Desconectado.", "");
      teardownPttAudio(false);
    };

    pttWs.onerror = () => pttWs?.close();
  }

  function startTalk() {
    pttHeld = true;
    if (!pttWs || pttWs.readyState !== WebSocket.OPEN) return;
    pttWs.send(JSON.stringify({ type: "ptt_start" }));
  }

  function stopTalk() {
    pttHeld = false;
    pttTransmitting = false;
    pttTalkBtn.classList.remove("talking");
    pttTalkBtn.textContent = "SEGURE PARA FALAR";
    if (pttWs && pttWs.readyState === WebSocket.OPEN) {
      pttWs.send(JSON.stringify({ type: "ptt_stop" }));
    }
  }

  pttConnectBtn.addEventListener("click", connectPttAudio);
  pttDisconnectBtn.addEventListener("click", () => teardownPttAudio(true));
  pttEndCallBtn.addEventListener("click", () => {
    if (pttWs && pttWs.readyState === WebSocket.OPEN) {
      pttWs.send(JSON.stringify({ type: "call_end" }));
    }
  });

  pttChannelSelect.addEventListener("change", () => {
    if (pttWs && pttWs.readyState === WebSocket.OPEN) {
      pttCurrentChannel = pttChannelSelect.value;
      pttWs.send(JSON.stringify({ type: "join", channel: pttCurrentChannel }));
    }
  });

  pttTalkBtn.addEventListener("mousedown", startTalk);
  pttTalkBtn.addEventListener("mouseup", stopTalk);
  pttTalkBtn.addEventListener("mouseleave", () => {
    if (pttTransmitting) stopTalk();
  });
  pttTalkBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    startTalk();
  });
  pttTalkBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    stopTalk();
  });

  if (password) {
    tryLogin(password).then((ok) => {
      if (!ok) showLogin();
    });
  }
})();
