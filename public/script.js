let currentPetId = null;
let updateInterval = null;

// Check if user is logged in
async function checkAuth() {
    try {
        const response = await fetch('/api/me');
        const data = await response.json();
        
        if (data.user) {
            document.getElementById('usernameDisplay').innerText = data.user.username;
            document.getElementById('authModal').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';
            await loadPets();
        } else {
            document.getElementById('authModal').style.display = 'flex';
            document.getElementById('mainApp').style.display = 'none';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

// Switch between login and register tabs
function switchTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabs = document.querySelectorAll('.tab-btn');
    
    if (tab === 'login') {
        loginForm.classList.add('active');
        registerForm.classList.remove('active');
        tabs[0].classList.add('active');
        tabs[1].classList.remove('active');
    } else {
        loginForm.classList.remove('active');
        registerForm.classList.add('active');
        tabs[0].classList.remove('active');
        tabs[1].classList.add('active');
    }
}

// Login
async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    errorDiv.innerText = '';
    
    if (!username || !password) {
        errorDiv.innerText = 'Please fill in all fields';
        return;
    }
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            checkAuth();
        } else {
            errorDiv.innerText = data.error || 'Login failed';
        }
    } catch (error) {
        errorDiv.innerText = 'Network error';
    }
}

// Register
async function register() {
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const errorDiv = document.getElementById('regError');
    
    errorDiv.innerText = '';
    
    if (!username || !email || !password) {
        errorDiv.innerText = 'Please fill in all fields';
        return;
    }
    
    if (password.length < 4) {
        errorDiv.innerText = 'Password must be at least 4 characters';
        return;
    }
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            checkAuth();
        } else {
            errorDiv.innerText = data.error || 'Registration failed';
        }
    } catch (error) {
        errorDiv.innerText = 'Network error';
    }
}

// Logout
async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    checkAuth();
}

// Load pets
async function loadPets() {
    try {
        const response = await fetch('/api/pets');
        const pets = await response.json();
        
        const petsList = document.getElementById('pets-list');
        if (pets.length === 0) {
            petsList.innerHTML = '<div class="loading">No pets yet. Create your first pet! 🎉</div>';
            return;
        }
        
        petsList.innerHTML = pets.map(pet => `
            <div class="pet-card ${!pet.is_alive ? 'dead' : ''} ${currentPetId === pet.id ? 'selected' : ''}" onclick="selectPet(${pet.id})">
                <div class="pet-name">${escapeHtml(pet.name)} ${!pet.is_alive ? '💀' : ''}</div>
                <div class="pet-stats-mini">🍕${pet.hunger} 😊${pet.happiness} ⚡${pet.energy}</div>
                <div class="pet-stats-mini">🎂 ${pet.age} min</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading pets:', error);
    }
}

// Select a pet
async function selectPet(id) {
    currentPetId = id;
    await loadPetStats();
    document.getElementById('no-pet-selected').style.display = 'none';
    document.getElementById('game-area').style.display = 'block';
    
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(loadPetStats, 10000);
    await loadPets();
}

// Load pet stats
async function loadPetStats() {
    if (!currentPetId) return;
    
    try {
        const response = await fetch(`/api/pets/${currentPetId}`);
        const pet = await response.json();
        
        if (!pet.is_alive) {
            clearInterval(updateInterval);
            alert(`${pet.name} has passed away... 💔`);
            backToPets();
            return;
        }
        
        updateStatsUI(pet);
        await loadEvents();
    } catch (error) {
        console.error('Error loading pet stats:', error);
    }
}

// Update UI with stats
function updateStatsUI(pet) {
    document.getElementById('pet-name-display').innerText = pet.name;
    document.getElementById('hunger-bar').style.width = `${pet.hunger}%`;
    document.getElementById('hunger-bar').innerHTML = pet.hunger > 15 ? `${pet.hunger}%` : '';
    document.getElementById('hunger-value').innerText = pet.hunger;
    document.getElementById('happiness-bar').style.width = `${pet.happiness}%`;
    document.getElementById('happiness-bar').innerHTML = pet.happiness > 15 ? `${pet.happiness}%` : '';
    document.getElementById('happiness-value').innerText = pet.happiness;
    document.getElementById('energy-bar').style.width = `${pet.energy}%`;
    document.getElementById('energy-bar').innerHTML = pet.energy > 15 ? `${pet.energy}%` : '';
    document.getElementById('energy-value').innerText = pet.energy;
    document.getElementById('age-value').innerText = pet.age;
    
    const emoji = document.getElementById('pet-emoji');
    if (pet.hunger < 30) emoji.innerText = '😫';
    else if (pet.happiness < 30) emoji.innerText = '😢';
    else if (pet.energy < 30) emoji.innerText = '😴';
    else emoji.innerText = '😊';
}

// Load events
async function loadEvents() {
    try {
        const response = await fetch(`/api/pets/${currentPetId}/events`);
        const events = await response.json();
        
        const eventsList = document.getElementById('events-list');
        if (events.length === 0) {
            eventsList.innerHTML = '<div class="event-item">No events yet</div>';
            return;
        }
        
        eventsList.innerHTML = events.map(event => `
            <div class="event-item">
                ${new Date(event.created_at).toLocaleTimeString()}: ${escapeHtml(event.message)}
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading events:', error);
    }
}

// Perform action
async function performAction(action) {
    if (!currentPetId) return;
    
    try {
        const response = await fetch(`/api/pets/${currentPetId}/${action}`, {
            method: 'POST'
        });
        
        if (response.ok) {
            await loadPetStats();
        } else {
            const error = await response.json();
            if (error.error.includes('dead')) {
                backToPets();
            }
        }
    } catch (error) {
        console.error(`Error performing ${action}:`, error);
    }
}

// Create new pet
async function createPet() {
    const name = document.getElementById('pet-name').value.trim();
    if (!name) {
        alert('Please enter a name for your pet!');
        return;
    }
    
    try {
        const response = await fetch('/api/pets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        if (response.ok) {
            document.getElementById('pet-name').value = '';
            await loadPets();
        } else {
            alert('Error creating pet');
        }
    } catch (error) {
        console.error('Error creating pet:', error);
    }
}

// Delete current pet
async function deleteCurrentPet() {
    if (!currentPetId) return;
    if (confirm('Are you sure you want to delete this pet? This action cannot be undone!')) {
        try {
            await fetch(`/api/pets/${currentPetId}`, { method: 'DELETE' });
            backToPets();
            await loadPets();
        } catch (error) {
            console.error('Error deleting pet:', error);
        }
    }
}

// Back to pets list
function backToPets() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    currentPetId = null;
    document.getElementById('no-pet-selected').style.display = 'flex';
    document.getElementById('game-area').style.display = 'none';
    loadPets();
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Event listeners
document.getElementById('create-pet-btn').addEventListener('click', createPet);
document.getElementById('feed-btn').addEventListener('click', () => performAction('feed'));
document.getElementById('play-btn').addEventListener('click', () => performAction('play'));
document.getElementById('sleep-btn').addEventListener('click', () => performAction('sleep'));
document.getElementById('delete-pet-btn').addEventListener('click', deleteCurrentPet);
document.getElementById('logoutBtn').addEventListener('click', logout);

// Enter key for creating pet
document.getElementById('pet-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        createPet();
    }
});

// Enter key for login/register
document.getElementById('loginPassword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});
document.getElementById('regPassword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') register();
});

// Initialize
checkAuth();
