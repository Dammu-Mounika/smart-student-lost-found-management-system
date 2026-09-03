/**
 * Smart Student Lost & Found Management System - Core Frontend App Logic
 * Vanilla JavaScript - Clean, beginner-friendly, and interview-explainable.
 */

// Global App State
const AppState = {
  currentUser: null,

  initUser() {
    const saved = localStorage.getItem("lost_found_user");
    if (saved) {
      try {
        this.currentUser = JSON.parse(saved);
      } catch (e) {
        this.currentUser = null;
        localStorage.removeItem("lost_found_user");
      }
    } else {
      this.currentUser = null;
    }
    return this.currentUser;
  },

  setUser(user) {
    this.currentUser = user;
    if (user) {
      localStorage.setItem("lost_found_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("lost_found_user");
    }
    this.updateNav();
  },

  logout() {
    const prevName = this.currentUser ? this.currentUser.name : "";
    this.setUser(null);
    showToast(prevName ? `Signed out ${prevName}` : "Signed out successfully");
    setTimeout(() => {
      window.location.href = "login.html";
    }, 400);
  },

  updateNav() {
    const authGroup = document.getElementById("nav-auth");
    if (!authGroup) return;

    if (this.currentUser) {
      authGroup.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.65rem;">
          <a href="dashboard.html" title="View Student Dashboard" style="font-weight: 600; color: var(--primary); display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.75rem; background: var(--primary-light); border-radius: var(--radius-md); font-size: 0.88rem; border: 1px solid #dbeafe; text-decoration: none;">
            <span>👤</span> <span>${escapeHtml(this.currentUser.name)}</span>
          </a>
          <button id="logout-btn" class="btn btn-secondary btn-sm" onclick="AppState.logout()" title="Sign out of current account">
            Sign Out
          </button>
        </div>
      `;
    } else {
      authGroup.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <a href="login.html" class="btn btn-secondary btn-sm">Sign In</a>
          <a href="register.html" class="btn btn-primary btn-sm">Register</a>
        </div>
      `;
    }
  },
};

// Immediate initialization so currentUser is ready synchronously
AppState.initUser();

// API Helper
async function apiFetch(endpoint, options = {}) {
  const defaultHeaders = {
    "Content-Type": "application/json",
  };

  options.headers = {
    ...defaultHeaders,
    ...options.headers,
  };

  try {
    const response = await fetch(`http://127.0.0.1:8000${endpoint}`, options);

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      // FastAPI validation error
      if (Array.isArray(data.detail)) {
        const errors = data.detail
          .map((error) => {
            const field = error.loc ? error.loc.join(".") : "field";

            return `${field}: ${error.msg}`;
          })
          .join("\n");

        throw new Error(errors);
      }

      throw new Error(
        data.detail ||
          data.message ||
          `Request failed with status ${response.status}`,
      );
    }

    return data;
  } catch (error) {
    console.error(`API Error on ${endpoint}:`, error);

    throw error;
  }
}
function escapeHTML(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
// Toast Notifications
function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.2s ease";
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// Custom In-App Non-Blocking Confirmation Modal (replaces window.confirm which is blocked in iframes)
function showCustomConfirm({
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmClass = "btn-primary",
  onConfirm,
}) {
  const existing = document.getElementById("custom-confirm-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "custom-confirm-modal";
  modal.className = "modal-overlay";
  modal.style.zIndex = "200";
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 440px; padding: 1.75rem; text-align: center; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);">
      <div style="font-size: 2.25rem; margin-bottom: 0.5rem;">🤝</div>
      <h3 style="font-size: 1.25rem; font-weight: 700; color: var(--text-main); margin-bottom: 0.5rem;">
        ${escapeHtml(title || "Please Confirm")}
      </h3>
      <p style="font-size: 0.95rem; color: var(--text-muted); line-height: 1.55; margin-bottom: 1.5rem;">
        ${escapeHtml(message || "Are you sure you want to proceed?")}
      </p>
      <div style="display: flex; gap: 0.75rem; justify-content: center;">
        <button type="button" id="custom-confirm-cancel-btn" class="btn btn-secondary" style="min-width: 100px;">
          ${escapeHtml(cancelText)}
        </button>
        <button type="button" id="custom-confirm-ok-btn" class="btn ${confirmClass}" style="min-width: 130px;">
          ${escapeHtml(confirmText)}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const cleanup = () => modal.remove();

  document
    .getElementById("custom-confirm-cancel-btn")
    .addEventListener("click", cleanup);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) cleanup();
  });

  document
    .getElementById("custom-confirm-ok-btn")
    .addEventListener("click", () => {
      cleanup();
      if (typeof onConfirm === "function") {
        onConfirm();
      }
    });
}

// Global Item Details Modal
function showItemModal(item) {
  const existing = document.getElementById("item-detail-modal");
  if (existing) existing.remove();

  const isLost = item.item_type === "lost";
  const typeBadge = isLost
    ? `<span class="badge badge-lost">Lost Item</span>`
    : `<span class="badge badge-found">Found Item</span>`;

  let statusClass = "badge-resolved";
  if (item.status === "Lost") statusClass = "badge-lost";
  if (item.status === "Found") statusClass = "badge-found";
  if (item.status === "Possible Match") statusClass = "badge-possible-match";
  if (item.status === "Match Verified") statusClass = "badge-verified";

  const modalHtml = `
    <div id="item-detail-modal" class="modal-overlay" onclick="if(event.target===this) this.remove()">
      <div class="modal-content">
        <button class="modal-close" onclick="document.getElementById('item-detail-modal').remove()">✕</button>
        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
          ${typeBadge}
          <span class="badge ${statusClass}">Status: ${escapeHtml(item.status)}</span>
        </div>
        <h2 style="font-size: 1.4rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text-main);">
          ${escapeHtml(item.item_name)}
        </h2>
        <div style="margin-bottom: 1.25rem;">
          <span class="badge" style="background:#f1f5f9; color:var(--text-muted); font-size:0.85rem;">📁 ${escapeHtml(item.category)}</span>
        </div>

        <div style="background: #f8fafc; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.25rem;">
          <ul class="item-spec-list">
            <li><span class="spec-label">Location:</span> <strong>📍 ${escapeHtml(item.location)}</strong></li>
            <li><span class="spec-label">Date:</span> <strong>📅 ${escapeHtml(item.date)}</strong></li>
            <li><span class="spec-label">Reported:</span> ${new Date(item.created_at || item.date).toLocaleDateString()}</li>
            <li><span class="spec-label">Contact:</span> <a href="mailto:${escapeHtml(item.contact_info || "")}">${escapeHtml(item.contact_info || "Available upon match")}</a></li>
          </ul>
        </div>

        <div style="margin-bottom: 1.5rem;">
          <h4 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.35rem;">Description:</h4>
          <p style="color: var(--text-muted); font-size: 0.95rem; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(item.description)}</p>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem; flex-wrap: wrap;">
          ${
            item.status === "Possible Match"
              ? `
            <button class="btn btn-primary btn-sm" onclick="document.getElementById('item-detail-modal').remove(); openMatchModalForReport(${item.id})">
              🎯 Review &amp; Confirm Match
            </button>
          `
              : `
            <a href="matches.html?item_id=${item.id}" class="btn btn-secondary btn-sm">Check Matches</a>
          `
          }
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('item-detail-modal').remove()">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);
}

// Global Match Modal (accessible from any page to view and immediately confirm matches)
async function openMatchModalForReport(itemId) {
  const existing = document.getElementById("report-match-modal");
  if (existing) existing.remove();

  showToast("Fetching match details...");

  try {
    const matches = await apiFetch(`/matches/${itemId}`);
    if (!matches || matches.length === 0) {
      showToast("No active match pairing found for report #" + itemId);
      return;
    }

    const match = matches[0];
    const lost = match.lost_item || {};
    const found = match.found_item || {};
    const b = match.breakdown || {};
    const isConfirmed = match.status === "Confirmed";

    const modalHtml = `
      <div id="report-match-modal" class="modal-overlay" onclick="if(event.target===this) this.remove()">
        <div class="modal-content" style="max-width: 680px; padding: 1.75rem;">
          <button class="modal-close" onclick="document.getElementById('report-match-modal').remove()">✕</button>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--text-subtle);">
                Match Review #${match.id}
              </div>
              <h2 style="font-size: 1.35rem; font-weight: 700; color: var(--text-main); margin: 0;">
                Smart Possible Match
              </h2>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="match-score-badge" style="background: ${match.match_score >= 80 ? "#ecfdf5" : "var(--warning-light)"}; color: ${match.match_score >= 80 ? "#065f46" : "#92400e"};">
                🎯 ${match.match_score}% Match Score
              </span>
              <span id="modal-match-status-badge" class="badge ${isConfirmed ? "badge-verified" : "badge-possible-match"}">
                ${escapeHtml(match.status)}
              </span>
            </div>
          </div>

          <!-- Comparison Columns -->
          <div class="match-comparison-grid" style="margin-bottom: 1rem;">
            <div class="comparison-column lost-side">
              <div class="column-header lost-title">Lost Report (#${lost.id})</div>
              <h4 style="font-weight: 700; margin-bottom: 0.5rem; color: var(--text-main); font-size: 1rem;">${escapeHtml(lost.item_name || "Lost Item")}</h4>
              <ul class="item-spec-list" style="font-size: 0.85rem;">
                <li><span class="spec-label">Category:</span> <strong>${escapeHtml(lost.category)}</strong></li>
                <li><span class="spec-label">Location:</span> <strong>📍 ${escapeHtml(lost.location)}</strong></li>
                <li><span class="spec-label">Date:</span> <strong>📅 ${escapeHtml(lost.date)}</strong></li>
                <li><span class="spec-label">Details:</span> ${escapeHtml(lost.description || "N/A")}</li>
              </ul>
            </div>
            <div class="comparison-column found-side">
              <div class="column-header found-title">Found Report (#${found.id})</div>
              <h4 style="font-weight: 700; margin-bottom: 0.5rem; color: var(--text-main); font-size: 1rem;">${escapeHtml(found.item_name || "Found Item")}</h4>
              <ul class="item-spec-list" style="font-size: 0.85rem;">
                <li><span class="spec-label">Category:</span> <strong>${escapeHtml(found.category)}</strong></li>
                <li><span class="spec-label">Location:</span> <strong>📍 ${escapeHtml(found.location)}</strong></li>
                <li><span class="spec-label">Date:</span> <strong>📅 ${escapeHtml(found.date)}</strong></li>
                <li><span class="spec-label">Details:</span> ${escapeHtml(found.description || "N/A")}</li>
              </ul>
            </div>
          </div>

          <!-- Score Breakdown -->
          <div class="score-breakdown-box" style="margin-bottom: 1.25rem;">
            <div class="breakdown-title" style="font-size: 0.85rem;">
              <span>Algorithm Score Breakdown:</span>
              <span style="font-weight: 700; color: var(--primary);">${match.match_score} / 100 Pts</span>
            </div>
            <div class="breakdown-chips">
              <div class="score-chip">Category: +${b.category_points ?? 0}/30</div>
              <div class="score-chip">Name: +${b.name_points ?? 0}/25</div>
              <div class="score-chip">Location: +${b.location_points ?? 0}/20</div>
              <div class="score-chip">Date: +${b.date_points ?? 0}/15</div>
              <div class="score-chip">Description: +${b.description_points ?? 0}/10</div>
            </div>
          </div>

          <!-- Contact Information & Action Section -->
          <div id="modal-match-actions-container">
            ${
              isConfirmed
                ? `
              <div style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 1rem; border-radius: var(--radius-md); margin-bottom: 1rem;">
                <div style="font-weight: 700; color: #065f46; margin-bottom: 0.35rem;">✅ Match Verified! Contact Details Unlocked:</div>
                <div style="font-size: 0.9rem; color: #064e3b;">
                  <div>Lost Report Contact: <strong>${escapeHtml(lost.contact_info || "Available")}</strong></div>
                  <div>Found Report Contact: <strong>${escapeHtml(found.contact_info || "Available")}</strong></div>
                </div>
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('report-match-modal').remove()">Close</button>
              </div>
            `
                : `
              <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 0.85rem; border-radius: var(--radius-md); font-size: 0.88rem; color: #1e40af; margin-bottom: 1.25rem;">
                ℹ️ Confirming this match will officially link both reports, update their statuses to <strong>Match Verified</strong>, and unlock contact details so both parties can connect.
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 0.75rem; flex-wrap: wrap;">
                <button type="button" class="btn btn-outline-danger btn-sm" onclick="directRejectMatchFromModal(${match.id})">
                  [Not a Match]
                </button>
                <button type="button" id="modal-confirm-btn" class="btn btn-success btn-sm" onclick="directConfirmMatchFromModal(${match.id}, ${lost.id}, ${found.id})">
                  ✅ Confirm This Match
                </button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('report-match-modal').remove()">
                  Cancel
                </button>
              </div>
            `
            }
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHtml);
  } catch (err) {
    showToast("Failed to load match: " + err.message, "danger");
  }
}

async function directConfirmMatchFromModal(matchId, lostId, foundId) {
  const btn = document.getElementById("modal-confirm-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Confirming match...";
  }

  try {
    const res = await apiFetch(`/matches/${matchId}/confirm`, {
      method: "POST",
    });
    showToast("🎉 Match confirmed successfully! Contact details unlocked.");

    // Update modal container in-place
    const container = document.getElementById("modal-match-actions-container");
    const badge = document.getElementById("modal-match-status-badge");
    if (badge) {
      badge.className = "badge badge-verified";
      badge.textContent = "Confirmed";
    }

    if (container) {
      const lost = res.lost_item || {};
      const found = res.found_item || {};
      container.innerHTML = `
        <div style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 1rem; border-radius: var(--radius-md); margin-bottom: 1rem;">
          <div style="font-weight: 700; color: #065f46; margin-bottom: 0.35rem;">🎉 Match Successfully Verified! Contact Details Unlocked:</div>
          <div style="font-size: 0.9rem; color: #064e3b; display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.5rem;">
            <div>👤 Lost Owner Contact: <a href="mailto:${escapeHtml(lost.contact_info || "")}" style="font-weight:700; color: var(--primary); text-decoration:underline;">${escapeHtml(lost.contact_info || "Available")}</a></div>
            <div>🤝 Finder Contact: <a href="mailto:${escapeHtml(found.contact_info || "")}" style="font-weight:700; color: var(--primary); text-decoration:underline;">${escapeHtml(found.contact_info || "Available")}</a></div>
          </div>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('report-match-modal').remove(); if(typeof loadDashboard==='function') loadDashboard(); if(typeof loadMatches==='function') loadMatches();">
            Done &amp; Refresh View
          </button>
        </div>
      `;
    }

    if (typeof loadDashboard === "function") {
      loadDashboard();
    }
    if (typeof loadMatches === "function") {
      loadMatches();
    }
  } catch (err) {
    showToast("Failed to confirm: " + err.message, "danger");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "✅ Confirm This Match";
    }
  }
}

async function directRejectMatchFromModal(matchId) {
  try {
    await apiFetch(`/matches/${matchId}/reject`, { method: "POST" });
    showToast("Match marked as Not a Match.");
    const modal = document.getElementById("report-match-modal");
    if (modal) modal.remove();
    if (typeof loadDashboard === "function") loadDashboard();
    if (typeof loadMatches === "function") loadMatches();
  } catch (err) {
    showToast("Failed to reject: " + err.message, "danger");
  }
}

// Helper: Escape HTML to avoid XSS
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Render Navigation Header
function renderHeader(activePage = "") {
  const header = document.querySelector("header.navbar");
  if (!header) return;

  header.innerHTML = `
    <div class="nav-container">
      <a href="index.html" class="nav-brand">
        <div class="nav-logo-badge">LF</div>
        <div>
          <span>Campus Lost & Found</span>
          <div style="font-size: 0.65rem; font-weight: 500; color: var(--text-subtle); line-height: 1;">Smart Student Portal</div>
        </div>
      </a>
      <ul class="nav-links">
        <li><a href="index.html" class="nav-link ${activePage === "home" ? "active" : ""}">Home</a></li>
        <li><a href="report-lost.html" class="nav-link ${activePage === "lost" ? "active" : ""}">Report Lost</a></li>
        <li><a href="report-found.html" class="nav-link ${activePage === "found" ? "active" : ""}">Report Found</a></li>
        <li><a href="search.html" class="nav-link ${activePage === "search" ? "active" : ""}">Search Items</a></li>
        <li><a href="matches.html" class="nav-link ${activePage === "matches" ? "active" : ""}">Possible Matches</a></li>
        <li><a href="dashboard.html" class="nav-link ${activePage === "dashboard" ? "active" : ""}">Dashboard</a></li>
        <li><a href="interview-guide.html" class="nav-link ${activePage === "interview" ? "active" : ""}" style="color: var(--accent); font-weight:600;">Interview Guide</a></li>
      </ul>
      <div id="nav-auth" class="nav-auth-group"></div>
    </div>
  `;
  AppState.updateNav();
}

// Render Footer
function renderFooter() {
  const footer = document.querySelector("footer.footer");
  if (footer) {
    footer.remove();
  }
}

// Initial Boot on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  AppState.initUser();
  AppState.updateNav();
});
