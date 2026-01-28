// Estado de la aplicación
const appState = {
    currentChat: null,
    chats: [],
    selectedIcon: '💡',
    editingChatId: null
};

// Utilidades para manejo de archivos
const FileUtils = {
    // Convertir archivo a base64
    toBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    // Formatear tamaño de archivo
    formatSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    },

    // Obtener extensión de archivo
    getExtension(filename) {
        return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2);
    }
};

// Gestión de almacenamiento
const Storage = {
    save() {
        const data = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            chats: appState.chats
        };
        localStorage.setItem('notechat_data', JSON.stringify(data));
    },

    load() {
        const data = localStorage.getItem('notechat_data');
        if (data) {
            try {
                const parsed = JSON.parse(data);
                appState.chats = parsed.chats || [];
                return true;
            } catch (e) {
                console.error('Error al cargar datos:', e);
                return false;
            }
        }
        return false;
    },

    export() {
        const data = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            chats: appState.chats
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `notechat_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    import(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.chats && Array.isArray(data.chats)) {
                        appState.chats = data.chats;
                        Storage.save();
                        resolve(true);
                    } else {
                        reject(new Error('Formato de archivo inválido'));
                    }
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }
};

// Inicializar la aplicación
function init() {
    // Verificar si hay datos guardados
    const hasData = Storage.load();
    
    if (hasData) {
        showApp();
        renderChats();
    } else {
        showStartModal();
    }
    
    setupEventListeners();
}

// Mostrar modal de inicio
function showStartModal() {
    document.getElementById('startModal').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
}

// Mostrar aplicación
function showApp() {
    document.getElementById('startModal').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
}

// Renderizar lista de chats
function renderChats() {
    const chatsList = document.getElementById('chatsList');
    
    if (appState.chats.length === 0) {
        chatsList.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="80" height="80">
                    <path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                </svg>
                <p>No hay chats todavía</p>
                <p>Crea uno para empezar</p>
            </div>
        `;
        return;
    }

    chatsList.innerHTML = '';
    appState.chats.forEach(chat => {
        const chatItem = createChatItem(chat);
        chatsList.appendChild(chatItem);
    });
}

// Crear elemento de chat
function createChatItem(chat) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    if (appState.currentChat === chat.id) {
        div.classList.add('active');
    }
    div.dataset.chatId = chat.id;
    
    const lastNote = chat.notes && chat.notes.length > 0 ? chat.notes[chat.notes.length - 1] : null;
    const preview = lastNote ? (lastNote.text || 'Archivo adjunto') : 'Sin notas';
    const time = lastNote ? new Date(lastNote.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
    
    div.innerHTML = `
        <div class="chat-item-icon">${chat.icon}</div>
        <div class="chat-item-content">
            <div class="chat-item-header">
                <span class="chat-item-name">${chat.name}</span>
                <span class="chat-item-time">${time}</span>
            </div>
            <div class="chat-item-preview">${preview}</div>
            ${chat.notes && chat.notes.length > 0 ? `
                <div class="chat-item-count">
                    <span class="count-badge">${chat.notes.length}</span>
                </div>
            ` : ''}
        </div>
    `;

    div.addEventListener('click', () => openChat(chat.id));
    return div;
}

// Abrir chat
function openChat(chatId) {
    const chat = appState.chats.find(c => c.id === chatId);
    if (!chat) return;

    appState.currentChat = chatId;

    // Actualizar UI
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    const chatItem = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (chatItem) chatItem.classList.add('active');

    // Mostrar vista de chat
    document.getElementById('defaultView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';

    // Actualizar información del chat
    document.getElementById('chatName').textContent = chat.name;
    document.getElementById('chatDescription').textContent = chat.description;
    document.getElementById('chatIcon').textContent = chat.icon;

    // Renderizar notas
    renderNotes(chatId);
}

// Renderizar notas
function renderNotes(chatId) {
    const container = document.getElementById('messagesContainer');
    const chat = appState.chats.find(c => c.id === chatId);
    
    if (!chat || !chat.notes || chat.notes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="80" height="80">
                    <path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
                </svg>
                <p>No hay notas en este chat</p>
                <p>Escribe algo para empezar</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    chat.notes.forEach(note => {
        const noteEl = createNoteElement(note);
        container.appendChild(noteEl);
    });

    // Scroll al final
    container.scrollTop = container.scrollHeight;
}

// Crear elemento de nota
function createNoteElement(note) {
    const div = document.createElement('div');
    div.className = 'message';
    
    const time = new Date(note.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    
    let attachmentsHtml = '';
    if (note.attachments && note.attachments.length > 0) {
        attachmentsHtml = '<div class="message-attachments">';
        note.attachments.forEach(att => {
            attachmentsHtml += `
                <div class="attachment">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
                    </svg>
                    <div class="attachment-info">
                        <div class="attachment-name">${att.name}</div>
                        <div class="attachment-size">${att.size}</div>
                    </div>
                </div>
            `;
        });
        attachmentsHtml += '</div>';
    }
    
    div.innerHTML = `
        <div class="message-bubble">
            ${note.text ? `<div class="message-text">${note.text}</div>` : ''}
            ${attachmentsHtml}
            <div class="message-time">${time}</div>
        </div>
    `;

    return div;
}

// Agregar nota
async function addNote() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    const fileInput = document.getElementById('fileAttach');
    const files = fileInput.files;

    if (!text && files.length === 0) return;
    if (!appState.currentChat) return;

    const chat = appState.chats.find(c => c.id === appState.currentChat);
    if (!chat) return;

    const note = {
        id: Date.now(),
        text: text,
        timestamp: new Date().toISOString(),
        attachments: []
    };

    // Procesar archivos adjuntos
    if (files.length > 0) {
        for (let file of files) {
            const attachment = {
                name: file.name,
                size: FileUtils.formatSize(file.size),
                type: file.type,
                data: await FileUtils.toBase64(file)
            };
            note.attachments.push(attachment);
        }
    }

    // Agregar nota al chat
    if (!chat.notes) chat.notes = [];
    chat.notes.push(note);

    // Guardar
    Storage.save();

    // Actualizar UI
    renderNotes(appState.currentChat);
    renderChats();
    
    // Limpiar inputs
    input.value = '';
    fileInput.value = '';
    input.style.height = 'auto';
}

// Crear/Editar chat
function saveChat() {
    const nameInput = document.getElementById('chatNameInput');
    const descInput = document.getElementById('chatDescInput');
    
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    
    if (!name) {
        alert('Por favor ingresa un nombre para el chat');
        return;
    }

    if (appState.editingChatId) {
        // Editar chat existente
        const chat = appState.chats.find(c => c.id === appState.editingChatId);
        if (chat) {
            chat.name = name;
            chat.description = description;
            chat.icon = appState.selectedIcon;
        }
    } else {
        // Crear nuevo chat
        const chat = {
            id: Date.now(),
            name: name,
            description: description,
            icon: appState.selectedIcon,
            notes: [],
            createdAt: new Date().toISOString()
        };
        appState.chats.unshift(chat);
    }

    Storage.save();
    renderChats();
    closeChatModal();
    
    // Si se creó un nuevo chat, abrirlo
    if (!appState.editingChatId) {
        openChat(appState.chats[0].id);
    } else if (appState.currentChat === appState.editingChatId) {
        openChat(appState.editingChatId);
    }
}

// Eliminar chat
function deleteChat() {
    if (!appState.currentChat) return;
    
    if (confirm('¿Estás seguro de eliminar este chat? Se perderán todas las notas.')) {
        appState.chats = appState.chats.filter(c => c.id !== appState.currentChat);
        Storage.save();
        appState.currentChat = null;
        renderChats();
        document.getElementById('defaultView').style.display = 'flex';
        document.getElementById('chatView').style.display = 'none';
    }
}

// Abrir modal de chat
function openChatModal(editMode = false) {
    appState.editingChatId = editMode ? appState.currentChat : null;
    const modal = document.getElementById('chatModal');
    const title = document.getElementById('modalTitle');
    
    if (editMode && appState.currentChat) {
        const chat = appState.chats.find(c => c.id === appState.currentChat);
        if (chat) {
            title.textContent = 'Editar Chat';
            document.getElementById('chatNameInput').value = chat.name;
            document.getElementById('chatDescInput').value = chat.description;
            appState.selectedIcon = chat.icon;
            updateIconSelection();
        }
    } else {
        title.textContent = 'Nuevo Chat';
        document.getElementById('chatNameInput').value = '';
        document.getElementById('chatDescInput').value = '';
        appState.selectedIcon = '💡';
        updateIconSelection();
    }
    
    modal.style.display = 'flex';
}

// Cerrar modal de chat
function closeChatModal() {
    document.getElementById('chatModal').style.display = 'none';
    appState.editingChatId = null;
}

// Actualizar selección de icono
function updateIconSelection() {
    document.querySelectorAll('.icon-option').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.icon === appState.selectedIcon) {
            btn.classList.add('selected');
        }
    });
}

// Buscar chats
function searchChats(query) {
    const filtered = appState.chats.filter(chat => 
        chat.name.toLowerCase().includes(query.toLowerCase()) ||
        chat.description.toLowerCase().includes(query.toLowerCase())
    );
    
    const chatsList = document.getElementById('chatsList');
    
    if (filtered.length === 0) {
        chatsList.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="80" height="80">
                    <path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <p>No se encontraron chats</p>
            </div>
        `;
        return;
    }
    
    chatsList.innerHTML = '';
    filtered.forEach(chat => {
        const chatItem = createChatItem(chat);
        chatsList.appendChild(chatItem);
    });
}

// Configurar event listeners
function setupEventListeners() {
    // Modal de inicio
    document.getElementById('newSession')?.addEventListener('click', () => {
        showApp();
        renderChats();
    });

    document.getElementById('loadSession')?.addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                await Storage.import(file);
                showApp();
                renderChats();
            } catch (error) {
                alert('Error al cargar el archivo: ' + error.message);
            }
        }
    });

    // Botones principales
    document.getElementById('addChatBtn')?.addEventListener('click', () => openChatModal(false));
    document.getElementById('exportBtn')?.addEventListener('click', () => Storage.export());
    document.getElementById('importBtn')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    await Storage.import(file);
                    renderChats();
                    alert('Datos importados correctamente');
                } catch (error) {
                    alert('Error al importar: ' + error.message);
                }
            }
        };
        input.click();
    });

    // Botones de chat
    document.getElementById('editChatBtn')?.addEventListener('click', () => openChatModal(true));
    document.getElementById('deleteChatBtn')?.addEventListener('click', deleteChat);

    // Modal de chat
    document.getElementById('closeModal')?.addEventListener('click', closeChatModal);
    document.getElementById('cancelBtn')?.addEventListener('click', closeChatModal);
    document.getElementById('saveChatBtn')?.addEventListener('click', saveChat);

    // Selección de iconos
    document.querySelectorAll('.icon-option').forEach(btn => {
        btn.addEventListener('click', () => {
            appState.selectedIcon = btn.dataset.icon;
            updateIconSelection();
        });
    });

    // Enviar nota
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');

    sendBtn?.addEventListener('click', addNote);
    messageInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            addNote();
        }
    });

    // Auto-resize textarea
    messageInput?.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });

    // Adjuntar archivo
    document.getElementById('attachBtn')?.addEventListener('click', () => {
        document.getElementById('fileAttach').click();
    });

    // Búsqueda
    const searchInput = document.getElementById('searchInput');
    searchInput?.addEventListener('input', (e) => {
        if (e.target.value.trim() === '') {
            renderChats();
        } else {
            searchChats(e.target.value);
        }
    });

    // Guardar automáticamente antes de cerrar
    window.addEventListener('beforeunload', () => {
        Storage.save();
    });
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', init);