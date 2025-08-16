// DOM elements
const userForm = document.getElementById('userForm');
const loadUsersBtn = document.getElementById('loadUsers');
const usersList = document.getElementById('usersList');
const statusElement = document.getElementById('status');
const statusDot = statusElement.querySelector('.status-dot');

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    checkDatabaseStatus();
    loadUsers();
});

// Form submission handler
userForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = new FormData(userForm);
    const userData = {
        name: formData.get('name'),
        email: formData.get('email')
    };
    
    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });
        
        if (response.ok) {
            const newUser = await response.json();
            showMessage('User added successfully!', 'success');
            userForm.reset();
            loadUsers(); // Reload users list
        } else {
            const error = await response.json();
            showMessage('Error: ' + error.error, 'error');
        }
    } catch (error) {
        showMessage('Network error: ' + error.message, 'error');
    }
});

// Load users button handler
loadUsersBtn.addEventListener('click', loadUsers);

// Load users function
async function loadUsers() {
    usersList.innerHTML = '<div class="loading">Loading users...</div>';
    
    try {
        const response = await fetch('/api/users');
        
        if (response.ok) {
            const users = await response.json();
            displayUsers(users);
            updateStatus('connected', `Database connected - ${users.length} users found`);
        } else {
            throw new Error('Failed to load users');
        }
    } catch (error) {
        usersList.innerHTML = '<div class="error">Failed to load users: ' + error.message + '</div>';
        updateStatus('error', 'Database connection error');
    }
}

// Display users in the UI
function displayUsers(users) {
    if (users.length === 0) {
        usersList.innerHTML = '<div class="loading">No users found</div>';
        return;
    }
    
    const usersHTML = users.map(user => `
        <div class="user-card">
            <div class="user-name">${escapeHtml(user.name)}</div>
            <div class="user-email">${escapeHtml(user.email)}</div>
            <div class="user-id">ID: ${user.id} | Created: ${formatDate(user.created_at)}</div>
        </div>
    `).join('');
    
    usersList.innerHTML = usersHTML;
}

// Check database status
async function checkDatabaseStatus() {
    try {
        const response = await fetch('/api/users');
        if (response.ok) {
            updateStatus('connected', 'Database connected');
        } else {
            updateStatus('error', 'Database connection error');
        }
    } catch (error) {
        updateStatus('error', 'Cannot connect to server');
    }
}

// Update status indicator
function updateStatus(status, message) {
    statusDot.className = `status-dot ${status}`;
    statusElement.querySelector('span:last-child').textContent = message;
}

// Show success/error messages
function showMessage(message, type) {
    // Remove existing messages
    const existingMessages = document.querySelectorAll('.success, .error');
    existingMessages.forEach(msg => msg.remove());
    
    // Create new message element
    const messageElement = document.createElement('div');
    messageElement.className = type;
    messageElement.textContent = message;
    
    // Insert after form
    userForm.parentNode.insertBefore(messageElement, userForm.nextSibling);
    
    // Remove message after 5 seconds
    setTimeout(() => {
        messageElement.remove();
    }, 5000);
}

// Utility function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Format date
function formatDate(dateString) {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Auto-refresh users every 30 seconds
setInterval(loadUsers, 30000);