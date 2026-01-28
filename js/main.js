// Estado de la aplicación
const appState = {
    currentChat: null,
    chats: [],
    selectedIcon: '💡',
    editingChatId: null,
    pendingAttachments: [],
    isMobile: window.innerWidth <= 480
};

// Utilidades para manejo de archivos
const FileUtils = {
    formatSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    },

    getExtension(filename) {
        return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2);
    },

    getMimeType(filename) {
        const ext = this.getExtension(filename).toLowerCase();
        const mimeTypes = {
            'pdf': 'application/pdf',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'txt': 'text/plain',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    },

    generateId() {
        return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
};

// Gestión de almacenamiento con IndexedDB
const Storage = {
    dbName: 'notechat_db',
    dbVersion: 1,
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('chats')) {
                    db.createObjectStore('chats', { keyPath: 'id' });
                }
                
                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files', { keyPath: 'id' });
                }
            };
        });
    },

    async saveChats() {
        if (!this.db) await this.init();
        
        const transaction = this.db.transaction(['chats'], 'readwrite');
        const store = transaction.objectStore('chats');
        
        // Guardar cada chat
        for (const chat of appState.chats) {
            const chatToSave = { ...chat };
            // Guardar solo referencias a archivos, no los datos
            if (chatToSave.notes) {
                chatToSave.notes = chatToSave.notes.map(note => ({
                    ...note,
                    attachments: note.attachments ? note.attachments.map(att => ({
                        id: att.id,
                        name: att.name,
                        size: att.size,
                        type: att.type,
                        path: att.path
                    })) : []
                }));
            }
            store.put(chatToSave);
        }
    },

    async loadChats() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chats'], 'readonly');
            const store = transaction.objectStore('chats');
            const request = store.getAll();

            request.onsuccess = () => {
                appState.chats = request.result || [];
                resolve(true);
            };
            request.onerror = () => reject(request.error);
        });
    },

    async saveFile(fileId, blob) {
        if (!this.db) await this.init();
        
        const transaction = this.db.transaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');
        
        store.put({ id: fileId, data: blob });
    },

    async getFile(fileId) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.get(fileId);

            request.onsuccess = () => {
                resolve(request.result ? request.result.data : null);
            };
            request.onerror = () => reject(request.error);
        });
    },

    async exportToZip() {
        const zip = new JSZip();
        
        // Crear estructura de carpetas
        const dataFolder = zip.folder('notechat_data');
        const filesFolder = dataFolder.folder('files');
        
        // Preparar datos de chats
        const exportData = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            chats: []
        };

        // Procesar cada chat
        for (const chat of appState.chats) {
            const chatExport = {
                ...chat,
                notes: []
            };

            // Procesar notas y archivos
            if (chat.notes) {
                for (const note of chat.notes) {
                    const noteExport = {
                        ...note,
                        attachments: []
                    };

                    // Guardar archivos adjuntos
                    if (note.attachments) {
                        for (const att of note.attachments) {
                            const fileBlob = await Storage.getFile(att.id);
                            if (fileBlob) {
                                const filePath = `chat_${chat.id}/${att.id}_${att.name}`;
                                filesFolder.file(filePath, fileBlob);
                                
                                noteExport.attachments.push({
                                    name: att.name,
                                    size: att.size,
                                    type: att.type,
                                    path: filePath
                                });
                            }
                        }
                    }

                    chatExport.notes.push(noteExport);
                }
            }

            exportData.chats.push(chatExport);
        }

        // Agregar archivo JSON con metadata
        dataFolder.file('data.json', JSON.stringify(exportData, null, 2));

        // Generar ZIP
        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, `notechat_backup_${new Date().toISOString().split('T')[0]}.zip`);
    },

    async importFromZip(file) {
        const zip = await JSZip.loadAsync(file);
        
        // Leer archivo JSON
        const dataFile = zip.file('notechat_data/data.json');
        if (!dataFile) {
            throw new Error('Archivo de datos no encontrado en el ZIP');
        }

        const jsonContent = await dataFile.async('string');
        const data = JSON.parse(jsonContent);

        if (!data.chats || !Array.isArray(data.chats)) {
            throw new Error('Formato de datos inválido');
        }

        // Limpiar datos anteriores
        appState.chats = [];

        // Procesar cada chat
        for (const chat of data.chats) {
            const chatImport = {
                ...chat,
                notes: []
            };

            // Procesar notas
            if (chat.notes) {
                for (const note of chat.notes) {
                    const noteImport = {
                        ...note,
                        attachments: []
                    };

                    // Importar archivos adjuntos
                    if (note.attachments) {
                        for (const att of note.attachments) {
                            const filePath = `notechat_data/files/${att.path}`;
                            const fileData = zip.file(filePath);
                            
                            if (fileData) {
                                const blob = await fileData.async('blob');
                                const fileId = FileUtils.generateId();
                                
                                // Guardar archivo en IndexedDB
                                await Storage.saveFile(fileId, blob);
                                
                                noteImport.attachments.push({
                                    id: fileId,
                                    name: att.name,
                                    size: att.size,
                                    type: att.type,
                                    path: att.path
                                });
                            }
                        }
                    }

                    chatImport.notes.push(noteImport);
                }
            }

            appState.chats.push(chatImport);
        }

        await Storage.saveChats();
        return true;
    }
};

// Gestión de vista móvil
const MobileView = {
    showSidebar() {
        if (appState.isMobile) {
            document.getElementById('sidebar').classList.remove('hidden');
            document.getElementById('chatView').parentElement.classList.remove('active');
        }
    },

    showChat() {
        if (appState.isMobile) {
            document.getElementById('sidebar').classList.add('hidden');
            document.getElementById('chatView').parentElement.classList.add('active');
        }
    }
};
// NUEVA FUNCIÓN: Resetear toda la aplicación
async function resetApplication() {
    const confirmation = confirm('⚠️ ¿Estás seguro de que deseas borrar TODOS los datos?\n\nEsta acción eliminará:\n• Todos los chats\n• Todas las notas\n• Todos los archivos adjuntos\n\nEsta acción NO se puede deshacer.');
    
    if (!confirmation) return;
    
    // Doble confirmación para seguridad
    const doubleConfirm = confirm('Esta es tu última oportunidad.\n\n¿Realmente deseas continuar y borrar todo?');
    
    if (!doubleConfirm) return;
    
    try {
        // Limpiar estado de la aplicación
        appState.currentChat = null;
        appState.chats = [];
        appState.pendingAttachments = [];
        appState.editingChatId = null;
        
        // Limpiar IndexedDB
        await Storage.clearAll();
        
        // Volver a la pantalla inicial
        showStartModal();
        
        // Limpiar UI
        document.getElementById('chatsList').innerHTML = '';
        document.getElementById('messagesContainer').innerHTML = '';
        
        alert('✓ Todos los datos han sido borrados exitosamente.');
    } catch (error) {
        console.error('Error al resetear la aplicación:', error);
        alert('Error al borrar los datos: ' + error.message);
    }
}
// Inicializar la aplicación
async function init() {
    await Storage.init();
    const hasData = await Storage.loadChats();
    
    if (hasData && appState.chats.length > 0) {
        showApp();
        renderChats();
    } else {
        showStartModal();
    }
    
    setupEventListeners();
    
    // Detectar cambios de tamaño de pantalla
    window.addEventListener('resize', () => {
        appState.isMobile = window.innerWidth <= 480;
    });
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
    if (appState.isMobile) {
        MobileView.showChat();
    } else {
        document.getElementById('defaultView').style.display = 'none';
        document.getElementById('chatView').style.display = 'flex';
    }

    // Actualizar información del chat
    document.getElementById('chatName').textContent = chat.name;
    document.getElementById('chatDescription').textContent = chat.description;
    document.getElementById('chatIcon').textContent = chat.icon;

    // Renderizar notas
    renderNotes(chatId);
}

// Renderizar notas
async function renderNotes(chatId) {
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
    for (const note of chat.notes) {
        const noteEl = await createNoteElement(note);
        container.appendChild(noteEl);
    }

    // Scroll al final
    container.scrollTop = container.scrollHeight;
}

// Crear elemento de nota
async function createNoteElement(note) {
    const div = document.createElement('div');
    div.className = 'message';
    
    const time = new Date(note.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    
    let attachmentsHtml = '';
    if (note.attachments && note.attachments.length > 0) {
        attachmentsHtml = '<div class="message-attachments">';
        for (const att of note.attachments) {
            attachmentsHtml += `
                <div class="attachment" data-file-id="${att.id}" data-file-name="${att.name}">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
                    </svg>
                    <div class="attachment-info">
                        <div class="attachment-name">${att.name}</div>
                        <div class="attachment-size">${att.size}</div>
                    </div>
                </div>
            `;
        }
        attachmentsHtml += '</div>';
    }
    
    div.innerHTML = `
        <div class="message-bubble">
            ${note.text ? `<div class="message-text">${note.text}</div>` : ''}
            ${attachmentsHtml}
            <div class="message-time">${time}</div>
        </div>
    `;

    // Agregar event listeners para descargar archivos
    div.querySelectorAll('.attachment').forEach(attEl => {
        attEl.addEventListener('click', async () => {
            const fileId = attEl.dataset.fileId;
            const fileName = attEl.dataset.fileName;
            await downloadFile(fileId, fileName);
        });
    });

    return div;
}

// Descargar archivo
async function downloadFile(fileId, fileName) {
    try {
        const blob = await Storage.getFile(fileId);
        if (blob) {
            saveAs(blob, fileName);
        } else {
            alert('Archivo no encontrado');
        }
    } catch (error) {
        console.error('Error al descargar archivo:', error);
        alert('Error al descargar el archivo');
    }
}

// Gestionar archivos adjuntos pendientes
function updateAttachmentsPreview() {
    const preview = document.getElementById('attachmentsPreview');
    const previewList = document.getElementById('attachmentsPreviewList');

    if (appState.pendingAttachments.length === 0) {
        preview.style.display = 'none';
        return;
    }

    preview.style.display = 'block';
    previewList.innerHTML = '';

    appState.pendingAttachments.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'attachment-preview-item';
        item.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/>
            </svg>
            <span>${file.name}</span>
            <button data-index="${index}">
                <svg viewBox="0 0 24 24" width="14" height="14">
                    <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
        `;

        const removeBtn = item.querySelector('button');
        removeBtn.addEventListener('click', () => {
            appState.pendingAttachments.splice(index, 1);
            updateAttachmentsPreview();
        });

        previewList.appendChild(item);
    });
}

// Agregar nota
async function addNote() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();

    if (!text && appState.pendingAttachments.length === 0) return;
    if (!appState.currentChat) return;

    const chat = appState.chats.find(c => c.id === appState.currentChat);
    if (!chat) return;

    const note = {
        id: FileUtils.generateId(),
        text: text,
        timestamp: new Date().toISOString(),
        attachments: []
    };

    // Procesar archivos adjuntos
    for (const file of appState.pendingAttachments) {
        const fileId = FileUtils.generateId();
        
        // Guardar archivo en IndexedDB
        await Storage.saveFile(fileId, file);
        
        const attachment = {
            id: fileId,
            name: file.name,
            size: FileUtils.formatSize(file.size),
            type: file.type
        };
        note.attachments.push(attachment);
    }

    // Agregar nota al chat
    if (!chat.notes) chat.notes = [];
    chat.notes.push(note);

    // Guardar
    await Storage.saveChats();

    // Actualizar UI
    await renderNotes(appState.currentChat);
    renderChats();
    
    // Limpiar inputs
    input.value = '';
    input.style.height = 'auto';
    appState.pendingAttachments = [];
    updateAttachmentsPreview();
}

// Crear/Editar chat
async function saveChat() {
    const nameInput = document.getElementById('chatNameInput');
    const descInput = document.getElementById('chatDescInput');
    
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    
    if (!name) {
        alert('Por favor ingresa un nombre para el chat');
        return;
    }

    if (appState.editingChatId) {
        const chat = appState.chats.find(c => c.id === appState.editingChatId);
        if (chat) {
            chat.name = name;
            chat.description = description;
            chat.icon = appState.selectedIcon;
        }
    } else {
        const chat = {
            id: FileUtils.generateId(),
            name: name,
            description: description,
            icon: appState.selectedIcon,
            notes: [],
            createdAt: new Date().toISOString()
        };
        appState.chats.unshift(chat);
    }

    await Storage.saveChats();
    renderChats();
    closeChatModal();
    
    if (!appState.editingChatId) {
        openChat(appState.chats[0].id);
    } else if (appState.currentChat === appState.editingChatId) {
        openChat(appState.editingChatId);
    }
}

// Eliminar chat
async function deleteChat() {
    if (!appState.currentChat) return;
    
    if (confirm('¿Estás seguro de eliminar este chat? Se perderán todas las notas.')) {
        appState.chats = appState.chats.filter(c => c.id !== appState.currentChat);
        await Storage.saveChats();
        appState.currentChat = null;
        renderChats();
        
        if (appState.isMobile) {
            MobileView.showSidebar();
        } else {
            document.getElementById('defaultView').style.display = 'flex';
            document.getElementById('chatView').style.display = 'none';
        }
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
                await Storage.importFromZip(file);
                showApp();
                renderChats();
                alert('Datos importados correctamente');
            } catch (error) {
                alert('Error al cargar el archivo: ' + error.message);
            }
        }
    });

    // Botones principales
    document.getElementById('addChatBtn')?.addEventListener('click', () => openChatModal(false));
    
    document.getElementById('exportBtn')?.addEventListener('click', async () => {
        try {
            await Storage.exportToZip();
        } catch (error) {
            alert('Error al exportar: ' + error.message);
        }
    });
    
    document.getElementById('importBtn')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    await Storage.importFromZip(file);
                    renderChats();
                    alert('Datos importados correctamente');
                } catch (error) {
                    alert('Error al importar: ' + error.message);
                }
            }
        };
        input.click();
    });
    // NUEVO: Botón de reset
    document.getElementById('resetBtn')?.addEventListener('click', resetApplication);

    // Botón de retroceso (móvil)
    document.getElementById('backButton')?.addEventListener('click', () => {
        MobileView.showSidebar();
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

    document.getElementById('fileAttach')?.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        appState.pendingAttachments.push(...files);
        updateAttachmentsPreview();
        e.target.value = '';
    });

    // Limpiar archivos adjuntos
    document.getElementById('clearAttachments')?.addEventListener('click', () => {
        appState.pendingAttachments = [];
        updateAttachmentsPreview();
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
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', init);