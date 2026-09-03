/**
 * Smart Student Lost & Found Management System
 * Core Frontend App Logic
 * Vanilla JavaScript - Beginner-friendly and interview-explainable
 */

// ============================================================
// GLOBAL APP STATE
// ============================================================

const AppState = {
  currentUser: null,

  initUser() {
    const saved = localStorage.getItem("lost_found_user");

    if (saved) {
      try {
        this.currentUser = JSON.parse(saved);
      } catch (error) {
        console.error("Invalid saved user:", error);
        this.currentUser = null;
      }
    }

    // Always maintain an active student profile so no sign-in is ever required!
    if (!this.currentUser) {
      this.currentUser = {
        id: 4,
        name: "Mounika Dammu",
        email: "mounikadammu83@gmail.com",
        phone: "9346215946"
      };
      localStorage.setItem("lost_found_user", JSON.stringify(this.currentUser));
    }

    return this.currentUser;
  },

  setUser(user) {
    if (user) {
      this.currentUser = user;
      localStorage.setItem("lost_found_user", JSON.stringify(user));
    } else {
      // Default to active student profile instead of locking out
      this.currentUser = {
        id: 4,
        name: "Mounika Dammu",
        email: "mounikadammu83@gmail.com",
        phone: "9346215946"
      };
      localStorage.setItem("lost_found_user", JSON.stringify(this.currentUser));
    }

    this.updateNav();
  },

  logout() {
    // Switch to Guest Student mode without forcing a login screen
    this.setUser({
      id: 1,
      name: "Guest Student",
      email: "guest@college.edu",
      phone: "9876543210"
    });

    showToast("Active profile: Guest Student (Open Access)");
    this.updateNav();
  },

  updateNav() {
    const authGroup = document.getElementById("nav-auth");

    if (!authGroup) {
      return;
    }

    const user = this.currentUser || {
      id: 4,
      name: "Mounika Dammu",
      email: "mounikadammu83@gmail.com"
    };

    authGroup.innerHTML = `
      <div style="
        display:flex;
        align-items:center;
        gap:0.5rem;
      ">
        <a
          href="dashboard.html"
          title="Active Student Profile - Click to view Dashboard"
          style="
            font-weight:600;
            color:var(--primary);
            display:inline-flex;
            align-items:center;
            gap:0.4rem;
            padding:0.35rem 0.75rem;
            background:var(--primary-light);
            border-radius:var(--radius-md);
            font-size:0.85rem;
            border:1px solid #dbeafe;
            text-decoration:none;
          "
        >
          <span>👤</span>
          <span>${escapeHTML(user.name)}</span>
        </a>
      </div>
    `;
  },
};

// Initialize user immediately
AppState.initUser();

// ============================================================
// API HELPER
// ============================================================

async function apiFetch(endpoint, options = {}) {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = cleanEndpoint.startsWith("/api/") || cleanEndpoint === "/api"
    ? cleanEndpoint
    : `/api${cleanEndpoint}`;

  console.log("API Request:", {
    method: options.method || "GET",
    url: url,
  });

  const requestOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  };

  let response;

  try {
    response = await fetch(url, requestOptions);
  } catch (error) {
    console.error("Network error:", error);

    throw new Error(
      "Cannot connect to server. Please check your network connection and try again.",
    );
  }

  let data = {};

  try {
    data = await response.json();
  } catch (error) {
    console.warn("Response is not JSON.");
  }

  console.log("API Response:", response.status, data);

  if (!response.ok) {
    let errorMessage = "";

    // FastAPI/Express detail error
    if (typeof data.detail === "string" && data.detail.trim()) {
      errorMessage = data.detail;
    }
    // FastAPI validation error array
    else if (Array.isArray(data.detail) && data.detail.length > 0) {
      errorMessage = data.detail
        .map((error) => {
          const location = Array.isArray(error.loc)
            ? error.loc.join(".")
            : "field";
          return `${location}: ${error.msg}`;
        })
        .join("\n");
    }
    // Other API error message
    else if (typeof data.message === "string" && data.message.trim()) {
      errorMessage = data.message;
    }
    else if (typeof data.error === "string" && data.error.trim()) {
      errorMessage = data.error;
    }
    // Status-specific fallbacks
    else if (response.status === 401) {
      errorMessage = "Invalid email or password. Please check your credentials.";
    }
    else if (response.status === 404) {
      errorMessage = "API service endpoint not found (HTTP 404).";
    }
    else if (response.status === 500) {
      errorMessage = "Server encountered an error (HTTP 500). Please try again.";
    }
    else {
      errorMessage = `Request failed (HTTP ${response.status}${response.statusText ? ' ' + response.statusText : ''})`;
    }

    throw new Error(errorMessage);
  }

  return data;
}

// ============================================================
// HTML ESCAPE HELPER
// ============================================================

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

// Keep lowercase version for compatibility with existing pages
function escapeHtml(value) {
  return escapeHTML(value);
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

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

  if (type === "danger" || type === "error") {
    toast.classList.add("toast-error");
  }

  if (type === "success") {
    toast.classList.add("toast-success");
  }

  toast.innerHTML = `
    <span>${escapeHTML(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.2s ease";

    setTimeout(() => {
      toast.remove();
    }, 200);
  }, 3500);
}

// ============================================================
// CUSTOM CONFIRM MODAL
// ============================================================

function showCustomConfirm({
  title = "Please Confirm",
  message = "Are you sure you want to proceed?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmClass = "btn-primary",
  onConfirm,
}) {
  const existing = document.getElementById("custom-confirm-modal");

  if (existing) {
    existing.remove();
  }

  const modal = document.createElement("div");

  modal.id = "custom-confirm-modal";
  modal.className = "modal-overlay";
  modal.style.zIndex = "200";

  modal.innerHTML = `
    <div
      class="modal-content"
      style="
        max-width:440px;
        padding:1.75rem;
        text-align:center;
        border-radius:var(--radius-lg);
        box-shadow:var(--shadow-lg);
      "
    >

      <div style="
        font-size:2.25rem;
        margin-bottom:0.5rem;
      ">
        🤝
      </div>

      <h3 style="
        font-size:1.25rem;
        font-weight:700;
        color:var(--text-main);
        margin-bottom:0.5rem;
      ">
        ${escapeHTML(title)}
      </h3>

      <p style="
        font-size:0.95rem;
        color:var(--text-muted);
        line-height:1.55;
        margin-bottom:1.5rem;
      ">
        ${escapeHTML(message)}
      </p>

      <div style="
        display:flex;
        gap:0.75rem;
        justify-content:center;
      ">

        <button
          type="button"
          id="custom-confirm-cancel-btn"
          class="btn btn-secondary"
          style="min-width:100px;"
        >
          ${escapeHTML(cancelText)}
        </button>

        <button
          type="button"
          id="custom-confirm-ok-btn"
          class="btn ${escapeHTML(confirmClass)}"
          style="min-width:130px;"
        >
          ${escapeHTML(confirmText)}
        </button>

      </div>

    </div>
  `;

  document.body.appendChild(modal);

  const cleanup = () => {
    modal.remove();
  };

  const cancelButton = document.getElementById("custom-confirm-cancel-btn");

  const confirmButton = document.getElementById("custom-confirm-ok-btn");

  if (cancelButton) {
    cancelButton.addEventListener("click", cleanup);
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      cleanup();
    }
  });

  if (confirmButton) {
    confirmButton.addEventListener("click", () => {
      cleanup();

      if (typeof onConfirm === "function") {
        onConfirm();
      }
    });
  }
}

// ============================================================
// ITEM DETAILS MODAL
// ============================================================

function showItemModal(item) {
  const existing = document.getElementById("item-detail-modal");

  if (existing) {
    existing.remove();
  }

  const isLost = item.item_type === "lost";

  const typeBadge = isLost
    ? `<span class="badge badge-lost">Lost Item</span>`
    : `<span class="badge badge-found">Found Item</span>`;

  let statusClass = "badge-resolved";

  if (item.status === "Lost") {
    statusClass = "badge-lost";
  }

  if (item.status === "Found") {
    statusClass = "badge-found";
  }

  if (item.status === "Possible Match") {
    statusClass = "badge-possible-match";
  }

  if (item.status === "Match Verified") {
    statusClass = "badge-verified";
  }

  const modalHTML = `
    <div
      id="item-detail-modal"
      class="modal-overlay"
      onclick="if(event.target===this) this.remove()"
    >

      <div class="modal-content">

        <button
          class="modal-close"
          onclick="
            document
              .getElementById('item-detail-modal')
              .remove()
          "
        >
          ✕
        </button>

        <div style="
          display:flex;
          gap:0.5rem;
          margin-bottom:0.75rem;
          flex-wrap:wrap;
        ">
          ${typeBadge}

          <span class="badge ${statusClass}">
            Status: ${escapeHTML(item.status)}
          </span>
        </div>

        <h2 style="
          font-size:1.4rem;
          font-weight:700;
          margin-bottom:0.5rem;
          color:var(--text-main);
        ">
          ${escapeHTML(item.item_name)}
        </h2>

        <div style="margin-bottom:1.25rem;">
          <span
            class="badge"
            style="
              background:#f1f5f9;
              color:var(--text-muted);
              font-size:0.85rem;
            "
          >
            📁 ${escapeHTML(item.category)}
          </span>
        </div>

        <div style="
          background:#f8fafc;
          border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);
          padding:1rem;
          margin-bottom:1.25rem;
        ">

          <ul class="item-spec-list">

            <li>
              <span class="spec-label">
                Location:
              </span>

              <strong>
                📍 ${escapeHTML(item.location)}
              </strong>
            </li>

            <li>
              <span class="spec-label">
                Date:
              </span>

              <strong>
                📅 ${escapeHTML(item.date)}
              </strong>
            </li>

            <li>
              <span class="spec-label">
                Reported:
              </span>

              ${
                item.created_at
                  ? new Date(item.created_at).toLocaleDateString()
                  : escapeHTML(item.date)
              }
            </li>

            <li>
              <span class="spec-label">
                Contact:
              </span>

              <a
                href="mailto:${escapeHTML(item.contact_info || "")}"
              >
                ${escapeHTML(item.contact_info || "Available upon match")}
              </a>
            </li>

          </ul>

        </div>

        <div style="margin-bottom:1.5rem;">

          <h4 style="
            font-size:0.95rem;
            font-weight:700;
            margin-bottom:0.35rem;
          ">
            Description:
          </h4>

          <p style="
            color:var(--text-muted);
            font-size:0.95rem;
            line-height:1.6;
            white-space:pre-wrap;
          ">
            ${escapeHTML(item.description)}
          </p>

        </div>

        <div style="
          display:flex;
          justify-content:flex-end;
          gap:0.75rem;
          border-top:1px solid var(--border-subtle);
          padding-top:1rem;
          flex-wrap:wrap;
        ">

          ${
            item.status === "Possible Match"
              ? `
                <button
                  class="btn btn-primary btn-sm"
                  onclick="
                    document
                      .getElementById('item-detail-modal')
                      .remove();

                    openMatchModalForReport(${item.id});
                  "
                >
                  🎯 Review &amp; Confirm Match
                </button>
              `
              : `
                <a
                  href="matches.html?item_id=${item.id}"
                  class="btn btn-secondary btn-sm"
                >
                  Check Matches
                </a>
              `
          }

          <button
            class="btn btn-secondary btn-sm"
            onclick="
              document
                .getElementById('item-detail-modal')
                .remove()
            "
          >
            Close
          </button>

        </div>

      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHTML);
}

// ============================================================
// MATCH DETAILS MODAL
// ============================================================

async function openMatchModalForReport(itemId) {
  const existing = document.getElementById("report-match-modal");

  if (existing) {
    existing.remove();
  }

  showToast("Fetching match details...");

  try {
    const matches = await apiFetch(`/matches/${itemId}`);

    if (!matches || matches.length === 0) {
      showToast(`No active match pairing found for report #${itemId}`);
      return;
    }

    const match = matches[0];

    const lost = match.lost_item || {};
    const found = match.found_item || {};
    const breakdown = match.breakdown || {};

    const isConfirmed = match.status === "Confirmed";

    const score = Number(match.match_score || 0);

    const modalHTML = `
      <div
        id="report-match-modal"
        class="modal-overlay"
        onclick="
          if(event.target===this) this.remove()
        "
      >

        <div
          class="modal-content"
          style="
            max-width:680px;
            padding:1.75rem;
          "
        >

          <button
            class="modal-close"
            onclick="
              document
                .getElementById('report-match-modal')
                .remove()
            "
          >
            ✕
          </button>

          <div style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            margin-bottom:1rem;
            flex-wrap:wrap;
            gap:0.5rem;
          ">

            <div>

              <div style="
                font-size:0.8rem;
                font-weight:700;
                text-transform:uppercase;
                color:var(--text-subtle);
              ">
                Match Review #${match.id}
              </div>

              <h2 style="
                font-size:1.35rem;
                font-weight:700;
                color:var(--text-main);
                margin:0;
              ">
                Smart Possible Match
              </h2>

            </div>

            <div style="
              display:flex;
              align-items:center;
              gap:0.5rem;
            ">

              <span
                class="match-score-badge"
                style="
                  background:${
                    score >= 80 ? "#ecfdf5" : "var(--warning-light)"
                  };
                  color:${score >= 80 ? "#065f46" : "#92400e"};
                "
              >
                🎯 ${score}% Match Score
              </span>

              <span
                id="modal-match-status-badge"
                class="badge ${
                  isConfirmed ? "badge-verified" : "badge-possible-match"
                }"
              >
                ${escapeHTML(match.status)}
              </span>

            </div>

          </div>


          <!-- COMPARISON -->

          <div
            class="match-comparison-grid"
            style="margin-bottom:1rem;"
          >

            <div class="comparison-column lost-side">

              <div class="column-header lost-title">
                Lost Report (#${lost.id || "-"})
              </div>

              <h4 style="
                font-weight:700;
                margin-bottom:0.5rem;
                color:var(--text-main);
                font-size:1rem;
              ">
                ${escapeHTML(lost.item_name || "Lost Item")}
              </h4>

              <ul
                class="item-spec-list"
                style="font-size:0.85rem;"
              >

                <li>
                  <span class="spec-label">
                    Category:
                  </span>

                  <strong>
                    ${escapeHTML(lost.category)}
                  </strong>
                </li>

                <li>
                  <span class="spec-label">
                    Location:
                  </span>

                  <strong>
                    📍 ${escapeHTML(lost.location)}
                  </strong>
                </li>

                <li>
                  <span class="spec-label">
                    Date:
                  </span>

                  <strong>
                    📅 ${escapeHTML(lost.date)}
                  </strong>
                </li>

                <li>
                  <span class="spec-label">
                    Details:
                  </span>

                  ${escapeHTML(lost.description || "N/A")}
                </li>

              </ul>

            </div>


            <div class="comparison-column found-side">

              <div class="column-header found-title">
                Found Report (#${found.id || "-"})
              </div>

              <h4 style="
                font-weight:700;
                margin-bottom:0.5rem;
                color:var(--text-main);
                font-size:1rem;
              ">
                ${escapeHTML(found.item_name || "Found Item")}
              </h4>

              <ul
                class="item-spec-list"
                style="font-size:0.85rem;"
              >

                <li>
                  <span class="spec-label">
                    Category:
                  </span>

                  <strong>
                    ${escapeHTML(found.category)}
                  </strong>
                </li>

                <li>
                  <span class="spec-label">
                    Location:
                  </span>

                  <strong>
                    📍 ${escapeHTML(found.location)}
                  </strong>
                </li>

                <li>
                  <span class="spec-label">
                    Date:
                  </span>

                  <strong>
                    📅 ${escapeHTML(found.date)}
                  </strong>
                </li>

                <li>
                  <span class="spec-label">
                    Details:
                  </span>

                  ${escapeHTML(found.description || "N/A")}
                </li>

              </ul>

            </div>

          </div>


          <!-- SCORE BREAKDOWN -->

          <div
            class="score-breakdown-box"
            style="margin-bottom:1.25rem;"
          >

            <div
              class="breakdown-title"
              style="font-size:0.85rem;"
            >

              <span>
                Algorithm Score Breakdown:
              </span>

              <span style="
                font-weight:700;
                color:var(--primary);
              ">
                ${score} / 100 Pts
              </span>

            </div>

            <div class="breakdown-chips">

              <div class="score-chip">
                Category:
                +${breakdown.category_points ?? 0}/30
              </div>

              <div class="score-chip">
                Name:
                +${breakdown.name_points ?? 0}/25
              </div>

              <div class="score-chip">
                Location:
                +${breakdown.location_points ?? 0}/20
              </div>

              <div class="score-chip">
                Date:
                +${breakdown.date_points ?? 0}/15
              </div>

              <div class="score-chip">
                Description:
                +${breakdown.description_points ?? 0}/10
              </div>

            </div>

          </div>


          <!-- ACTIONS -->

          <div id="modal-match-actions-container">

            ${
              isConfirmed
                ? `
                  <div style="
                    background:#ecfdf5;
                    border:1px solid #a7f3d0;
                    padding:1rem;
                    border-radius:var(--radius-md);
                    margin-bottom:1rem;
                  ">

                    <div style="
                      font-weight:700;
                      color:#065f46;
                      margin-bottom:0.35rem;
                    ">
                      ✅ Match Verified!
                      Contact Details Unlocked:
                    </div>

                    <div style="
                      font-size:0.9rem;
                      color:#064e3b;
                    ">

                      <div>
                        Lost Report Contact:
                        <strong>
                          ${escapeHTML(lost.contact_info || "Available")}
                        </strong>
                      </div>

                      <div>
                        Found Report Contact:
                        <strong>
                          ${escapeHTML(found.contact_info || "Available")}
                        </strong>
                      </div>

                    </div>

                  </div>

                  <div style="
                    display:flex;
                    justify-content:flex-end;
                    gap:0.75rem;
                  ">

                    <button
                      class="btn btn-secondary btn-sm"
                      onclick="
                        document
                          .getElementById(
                            'report-match-modal'
                          )
                          .remove()
                      "
                    >
                      Close
                    </button>

                  </div>
                `
                : `
                  <div style="
                    background:#eff6ff;
                    border:1px solid #bfdbfe;
                    padding:0.85rem;
                    border-radius:var(--radius-md);
                    font-size:0.88rem;
                    color:#1e40af;
                    margin-bottom:1.25rem;
                  ">
                    ℹ️ Confirming this match will
                    officially link both reports,
                    update their statuses to
                    <strong>Match Verified</strong>,
                    and unlock contact details.
                  </div>

                  <div style="
                    display:flex;
                    justify-content:flex-end;
                    gap:0.75rem;
                    flex-wrap:wrap;
                  ">

                    <button
                      type="button"
                      class="btn btn-outline-danger btn-sm"
                      onclick="
                        directRejectMatchFromModal(
                          ${match.id}
                        )
                      "
                    >
                      [Not a Match]
                    </button>

                    <button
                      type="button"
                      id="modal-confirm-btn"
                      class="btn btn-success btn-sm"
                      onclick="
                        directConfirmMatchFromModal(
                          ${match.id},
                          ${lost.id},
                          ${found.id}
                        )
                      "
                    >
                      ✅ Confirm This Match
                    </button>

                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      onclick="
                        document
                          .getElementById(
                            'report-match-modal'
                          )
                          .remove()
                      "
                    >
                      Cancel
                    </button>

                  </div>
                `
            }

          </div>

        </div>

      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHTML);
  } catch (error) {
    console.error("Failed to load match:", error);

    showToast("Failed to load match: " + error.message, "danger");
  }
}

// ============================================================
// CONFIRM MATCH
// ============================================================

async function directConfirmMatchFromModal(matchId, lostId, foundId) {
  const button = document.getElementById("modal-confirm-btn");

  if (button) {
    button.disabled = true;
    button.textContent = "Confirming match...";
  }

  try {
    const response = await apiFetch(`/matches/${matchId}/confirm`, {
      method: "POST",
    });

    showToast("🎉 Match confirmed successfully!", "success");

    const container = document.getElementById("modal-match-actions-container");

    const badge = document.getElementById("modal-match-status-badge");

    if (badge) {
      badge.className = "badge badge-verified";

      badge.textContent = "Confirmed";
    }

    if (container) {
      container.innerHTML = `
        <div style="
          background:#ecfdf5;
          border:1px solid #a7f3d0;
          padding:1rem;
          border-radius:var(--radius-md);
          margin-bottom:1rem;
        ">

          <div style="
            font-weight:700;
            color:#065f46;
            margin-bottom:0.35rem;
          ">
            🎉 Match Successfully Verified!
          </div>

          <p style="
            font-size:0.9rem;
            color:#064e3b;
          ">
            Both reports are now linked.
            The parties can contact each other
            to retrieve the item.
          </p>

        </div>

        <div style="
          display:flex;
          justify-content:flex-end;
          gap:0.75rem;
        ">

          <button
            class="btn btn-primary btn-sm"
            onclick="
              document
                .getElementById(
                  'report-match-modal'
                )
                .remove();

              if (
                typeof loadDashboard ===
                'function'
              ) {
                loadDashboard();
              }

              if (
                typeof loadMatches ===
                'function'
              ) {
                loadMatches();
              }
            "
          >
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
  } catch (error) {
    console.error("Failed to confirm match:", error);

    showToast("Failed to confirm: " + error.message, "danger");

    if (button) {
      button.disabled = false;
      button.textContent = "✅ Confirm This Match";
    }
  }
}

// ============================================================
// REJECT MATCH
// ============================================================

async function directRejectMatchFromModal(matchId) {
  try {
    await apiFetch(`/matches/${matchId}/reject`, {
      method: "POST",
    });

    showToast("Match marked as Not a Match.", "success");

    const modal = document.getElementById("report-match-modal");

    if (modal) {
      modal.remove();
    }

    if (typeof loadDashboard === "function") {
      loadDashboard();
    }

    if (typeof loadMatches === "function") {
      loadMatches();
    }
  } catch (error) {
    console.error("Failed to reject match:", error);

    showToast("Failed to reject: " + error.message, "danger");
  }
}

// ============================================================
// NAVIGATION HEADER
// ============================================================

function renderHeader(activePage = "") {
  const header = document.querySelector("header.navbar");

  if (!header) {
    return;
  }

  header.innerHTML = `
    <div class="nav-container">

      <a
        href="index.html"
        class="nav-brand"
      >

        <div class="nav-logo-badge">
          LF
        </div>

        <div>

          <span>
            Campus Lost & Found
          </span>

          <div style="
            font-size:0.65rem;
            font-weight:500;
            color:var(--text-subtle);
            line-height:1;
          ">
            Smart Student Portal
          </div>

        </div>

      </a>


      <ul class="nav-links">

        <li>
          <a
            href="index.html"
            class="nav-link ${activePage === "home" ? "active" : ""}"
          >
            Home
          </a>
        </li>

        <li>
          <a
            href="report-lost.html"
            class="nav-link ${activePage === "lost" ? "active" : ""}"
          >
            Report Lost
          </a>
        </li>

        <li>
          <a
            href="report-found.html"
            class="nav-link ${activePage === "found" ? "active" : ""}"
          >
            Report Found
          </a>
        </li>

        <li>
          <a
            href="search.html"
            class="nav-link ${activePage === "search" ? "active" : ""}"
          >
            Search Items
          </a>
        </li>

        <li>
          <a
            href="matches.html"
            class="nav-link ${activePage === "matches" ? "active" : ""}"
          >
            Possible Matches
          </a>
        </li>

        <li>
          <a
            href="dashboard.html"
            class="nav-link ${activePage === "dashboard" ? "active" : ""}"
          >
            Dashboard
          </a>
        </li>

        <li>
          <a
            href="interview-guide.html"
            class="nav-link ${activePage === "interview" ? "active" : ""}"
            style="
              color:var(--accent);
              font-weight:600;
            "
          >
            Interview Guide
          </a>
        </li>

      </ul>


      <div
        id="nav-auth"
        class="nav-auth-group"
      ></div>

    </div>
  `;

  AppState.updateNav();
}

// ============================================================
// FOOTER
// ============================================================

function renderFooter() {
  const footer = document.querySelector("footer.footer");

  if (footer) {
    footer.remove();
  }
}

// ============================================================
// INITIAL BOOT
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  AppState.initUser();
  AppState.updateNav();
});
