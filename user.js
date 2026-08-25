// ==UserScript==
// @name         FB Blocked Users Manager
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Массовый бан дублей FB
// @author       Yellow Web / Modified
// @match        https://www.facebook.com/*
// @grant        none
// @updateURL    ТУТ_БУДЕТ_ССЫЛКА_НА_RAW_ФАЙЛ_ДЛЯ_АВТООБНОВЛЕНИЯ
// ==/UserScript==

(function() {
    'use strict';

  class FileHelper {
  readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject("Error reading file");
      reader.readAsText(file);
    });
  }

  downloadFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

class BlockedUsersAPI {
  async privateAsyncRequest(
    variables,
    docId,
    url = null,
    suppressEvaluation = true
  ) {
    if (url == null) url = "/api/graphql";
    var uid = this.getCurrentProfile();
    
    return new Promise(async (resolve, reject) => {
      try {
        let req = new AsyncRequest()
          .setOption("suppressEvaluation", suppressEvaluation)
          .setOption("asynchronous_DEPRECATED", !0)
          .setOption("retries", 10)
          .setAllowCrossOrigin(!0)
          .setAllowCrossPageTransition(!0)
          .setURI(url)
          .setMethod("POST")
          .setData({
            av: uid, 
            __user:uid, 
            doc_id: docId, 
            variables: JSON.stringify(variables) 
          })
          .setHandler((e) => {
            resolve(JSON.parse(e.payload.responseText));
          });

        req.send();
      } catch (error) {
        reject(error);
      }
    });
  }
  
  async switchProfile(fromProfileId, toProfileId) 
  {
    var lsd = require("LSD").token;
    var dtsg = require("DTSGInitData").token;
    var f = await fetch("https://www.facebook.com/api/graphql/", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-fb-friendly-name": "CometProfileSwitchMutation",
        "x-fb-lsd": lsd,
        "referer": "https://www.facebook.com/",
        "sec-fetch-site": "same-origin",
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9"
      },
      body: new URLSearchParams({
        av: fromProfileId,
        __user: fromProfileId,
        __a: "1",
        __req: "1",
        dpr: "1",
        __ccg: "EXCELLENT",
        __comet_req: "15",
        fb_dtsg: dtsg,
        jazoest: "25493",
        lsd: lsd,
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: "CometProfileSwitchMutation",
        variables: JSON.stringify({ profile_id: toProfileId }),
        doc_id: "29569331136046912"
      }).toString()
    });
    
    var resp = await f.json();
    console.log(resp);
    return resp?.data?.profile_switcher_comet_login;
  }

  getCurrentProfile() {
    const cookie = document.cookie;
    const match = cookie.match(/i_user=([^;]+)/);
    return match ? match[1] : null;
  }

  async getPages() {
    var resp = await require('AdsGraphAPI')
      .get('22.0')
      .me().edge('accounts')
      .get({ fields: ['id', 'name', 'access_token', 'additional_profile_id'] });
    return resp.data || [];
  }

  async exportBlockedUsers(profile_id) {
    const js = await this.privateAsyncRequest(
      {
        profile_picture_size: 36,
        settingType: "USER",
        search:""
      },
      "9508788085855523"
    );
    let setting = js.data.viewer.privacy_block_settings.setting;
    const users = [];

    console.log(setting.blockees.edges);
    for (const edge of setting.blockees.edges) {
      users.push(edge.node.id);
    }

    return users;
  }

  async blockUsers(fpId, fpToken, userIds) {
    var resp = await require('AdsGraphAPI')
      .get('22.0')
      .object("page",fpId).edge("blocked")
      .post({ 
        access_token:fpToken,
        user:userIds
      });
    return resp;
  }

  async getMainUser() {
    const user = await require("AdsGraphAPI")
      .get("22.0")
      .me()
      .get({ fields: ["name", "id"] });
    return user;
  }
}

class UIManager {
  constructor(api, fileHelper) {
    this.api = api;
    this.fileHelper = fileHelper;
    this.modal = null;
    this.pages = [];
    this.selectedPage = null;
    this.importCancelled = false;
  }

  createStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .fbblocked-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 600px;
        max-height: 80vh;
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(255, 193, 7, 0.3);
        z-index: 10000;
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #ffc107;
        overflow-y: auto;
        border: 2px solid #ffc107;
      }

      .fbblocked-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }

      .fbblocked-header-left {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .fbblocked-credit {
        font-size: 11px;
        color: #999;
      }

      .fbblocked-credit a {
        color: #ffc107;
        text-decoration: none;
        transition: color 0.3s;
      }

      .fbblocked-credit a:hover {
        color: #ffeb3b;
        text-decoration: underline;
      }

      .fbblocked-title {
        font-size: 20px;
        font-weight: bold;
        margin: 0;
        color: #ffc107;
      }

      .fbblocked-close {
        background: rgba(255, 193, 7, 0.2);
        border: 1px solid #ffc107;
        color: #ffc107;
        font-size: 20px;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.3s;
      }

      .fbblocked-close:hover {
        background: #ffc107;
        color: #000;
      }

      .fbblocked-section {
        background: rgba(0, 0, 0, 0.4);
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 15px;
        color: #ffc107;
        border: 1px solid rgba(255, 193, 7, 0.3);
      }

      .fbblocked-section-title {
        font-weight: bold;
        font-size: 14px;
        margin-bottom: 10px;
        color: #ffeb3b;
      }

      .fbblocked-page-selector {
        width: 100%;
        padding: 10px;
        border: 2px solid #ffc107;
        border-radius: 6px;
        font-size: 14px;
        background: #000;
        color: #ffc107;
        cursor: pointer;
        transition: border-color 0.3s;
      }

      .fbblocked-page-selector:focus {
        outline: none;
        border-color: #ffeb3b;
      }

      .fbblocked-page-selector option {
        background: #000;
        color: #ffc107;
      }

      .fbblocked-page-option {
        padding: 8px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .fbblocked-page-icon {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: cover;
      }

      .fbblocked-page-info {
        flex: 1;
      }

      .fbblocked-page-name {
        font-weight: bold;
        font-size: 14px;
      }

      .fbblocked-page-id {
        font-size: 11px;
        color: #999;
      }

      .fbblocked-buttons {
        display: flex;
        gap: 10px;
        margin-top: 10px;
      }

      .fbblocked-btn {
        flex: 1;
        padding: 12px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .fbblocked-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .fbblocked-btn:active {
        transform: translateY(0);
      }

      .fbblocked-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .fbblocked-btn-export {
        background: #ffc107;
        color: #000;
        border: 2px solid #ffc107;
      }

      .fbblocked-btn-export:hover {
        background: #ffeb3b;
        border-color: #ffeb3b;
      }

      .fbblocked-btn-import {
        background: transparent;
        color: #ffc107;
        border: 2px solid #ffc107;
      }

      .fbblocked-btn-import:hover {
        background: #ffc107;
        color: #000;
      }

      .fbblocked-btn-stop {
        background: #ff5722;
        color: #000;
        border: 2px solid #ff5722;
        display: none;
        margin-top: 10px;
      }

      .fbblocked-btn-stop:hover {
        background: #ff7043;
        border-color: #ff7043;
      }

      .fbblocked-btn-stop.active {
        display: block;
      }

      .fbblocked-progress-container {
        margin-top: 10px;
        display: none;
      }

      .fbblocked-progress-bar {
        width: 100%;
        height: 24px;
        border-radius: 12px;
        overflow: hidden;
        background: #000;
        border: 1px solid #ffc107;
      }

      .fbblocked-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #ffc107 0%, #ffeb3b 100%);
        transition: width 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #000;
        font-size: 12px;
        font-weight: bold;
      }

      .fbblocked-progress-text {
        margin-top: 5px;
        font-size: 12px;
        text-align: center;
        color: #ffc107;
      }

      .fbblocked-log {
        background: #000;
        color: #ffc107;
        padding: 10px;
        border-radius: 6px;
        max-height: 200px;
        overflow-y: auto;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        line-height: 1.5;
        border: 1px solid rgba(255, 193, 7, 0.3);
      }

      .fbblocked-log-entry {
        margin: 2px 0;
      }

      .fbblocked-log-info {
        color: #ffc107;
      }

      .fbblocked-log-error {
        color: #ff5722;
      }

      .fbblocked-log-warning {
        color: #ffeb3b;
      }

      .fbblocked-log-time {
        color: #999;
      }

      .fbblocked-file-input {
        display: none;
      }
    `;
    document.head.appendChild(style);
  }

  async createModal() {
    this.createStyles();

    this.modal = document.createElement("div");
    this.modal.className = "fbblocked-modal";
    this.modal.innerHTML = `
      <div class="fbblocked-header">
        <div class="fbblocked-header-left">
          <h2 class="fbblocked-title">FB Blocked Users Manager v2025-01-08</h2>
          <div class="fbblocked-credit">by <a href="https://t.me/yellow_web" target="_blank">Yellow Web</a></div>
        </div>
        <button class="fbblocked-close">×</button>
      </div>

      <div class="fbblocked-section">
        <div class="fbblocked-section-title">Select Fan Page</div>
        <select class="fbblocked-page-selector" id="fbblocked-page-select">
          <option value="">Loading pages...</option>
        </select>
      </div>

      <div class="fbblocked-section">
        <div class="fbblocked-section-title">Actions</div>
        <div class="fbblocked-buttons">
          <button class="fbblocked-btn fbblocked-btn-export" id="fbblocked-export-btn">
            Export Blocked Users
          </button>
          <button class="fbblocked-btn fbblocked-btn-import" id="fbblocked-import-btn">
            Import Blocked Users
          </button>
        </div>
        <input type="file" class="fbblocked-file-input" id="fbblocked-file-input" accept=".txt">
        <button class="fbblocked-btn fbblocked-btn-stop" id="fbblocked-stop-btn">
          Stop Import
        </button>
        <div class="fbblocked-progress-container" id="fbblocked-progress-container">
          <div class="fbblocked-progress-bar">
            <div class="fbblocked-progress-fill" id="fbblocked-progress-fill">0%</div>
          </div>
          <div class="fbblocked-progress-text" id="fbblocked-progress-text"></div>
        </div>
      </div>

      <div class="fbblocked-section">
        <div class="fbblocked-section-title">Log</div>
        <div class="fbblocked-log" id="fbblocked-log">
          <div class="fbblocked-log-entry fbblocked-log-info">
            <span class="fbblocked-log-time">[${this.getTime()}]</span> Manager initialized
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.modal);

    // Event listeners
    this.modal.querySelector(".fbblocked-close").onclick = () => this.close();
    this.modal
      .querySelector("#fbblocked-export-btn")
      .onclick = () => this.handleExport();
    this.modal
      .querySelector("#fbblocked-import-btn")
      .onclick = () => this.handleImport();
    this.modal
      .querySelector("#fbblocked-stop-btn")
      .onclick = () => this.cancelImport();

    await this.loadPages();
  }

  async loadPages() {
    try {
      this.log("Loading fan pages...", "info");
      this.pages = await this.api.getPages();

      const select = this.modal.querySelector("#fbblocked-page-select");
      select.innerHTML = '<option value="">-- Select a Fan Page --</option>';

      this.pages.forEach((page) => {
        const option = document.createElement("option");
        option.value = page.id;
        option.textContent = `${page.name} (ID: ${page.id})`;
        option.dataset.token = page.access_token;
        option.dataset.additional_profile_id = page.additional_profile_id;
        select.appendChild(option);
      });

      this.log(`Loaded ${this.pages.length} fan pages`, "info");
    } catch (error) {
      this.log(`Error loading pages: ${error.message}`, "error");
    }
  }

  getSelectedPage() {
    const select = this.modal.querySelector("#fbblocked-page-select");
    const selectedId = select.value;
    if (!selectedId) return null;

    const selectedOption = select.options[select.selectedIndex];
    return {
      id: selectedId,
      name: select.options[select.selectedIndex].textContent,
      access_token: selectedOption.dataset.token,
      additional_profile_id: selectedOption.dataset.additional_profile_id,
    };
  }

  async handleExport() {
    const page = this.getSelectedPage();
    if (!page) {
      alert("Please select a fan page first!");
      return;
    }

    const exportBtn = this.modal.querySelector("#fbblocked-export-btn");
    const importBtn = this.modal.querySelector("#fbblocked-import-btn");
    exportBtn.disabled = true;
    importBtn.disabled = true;

    try {
      this.log(`Starting export for page: ${page.name}`, "info");

      // Check current profile
      const currentProfile = this.api.getCurrentProfile();
      const mainUser = await this.api.getMainUser();
      this.log(`Main user: ${mainUser.name} (${mainUser.id})`, "info");

      // Switch to page profile
      if (currentProfile !== page.additional_profile_id) {
        this.log(`Switching to page profile ${page.name}...`, "info");
        const switched = await this.api.switchProfile(mainUser.id,page.additional_profile_id);
        if (!switched) {
          throw new Error("Failed to switch to page profile");
        }
        this.log(`SWITCHED to page profile successfully`, "info");
        // Wait a bit for the switch to complete
        await this.sleep(1000);
      } else {
        this.log(`Already on page profile`, "info");
      }

      // Export blocked users
      this.log(`Fetching blocked users...`, "info");
      const users = await this.api.exportBlockedUsers(page.additional_profile_id);
      this.log(`Found ${users.length} blocked users`, "info");

      this.log(`Switching back to main profile...`, "info");
      await this.api.switchProfile(page.additional_profile_id, mainUser.id);
      this.log(`SWITCHED back to main profile`, "info");

      // Download file
      const content = users.join("\n");
      const filename = `blocked_users_${page.id}_${Date.now()}.txt`;
      this.fileHelper.downloadFile(content, filename);
      this.log(`✅ Export complete! File: ${filename}`, "info");
    } catch (error) {
      this.log(`❌ Export failed: ${error.message}`, "error");
      console.error(error);
    } finally {
      exportBtn.disabled = false;
      importBtn.disabled = false;
    }
  }

  async handleImport() {
    const page = this.getSelectedPage();
    if (!page) {
      alert("Please select a fan page first!");
      return;
    }

    const fileInput = this.modal.querySelector("#fbblocked-file-input");
    fileInput.click();

    fileInput.onchange = async () => {
      if (!fileInput.files || fileInput.files.length === 0) {
        return;
      }

      const file = fileInput.files[0];
      await this.processImport(page, file);
      fileInput.value = ""; // Reset input
    };
  }

  async processImport(page, file) {
    const exportBtn = this.modal.querySelector("#fbblocked-export-btn");
    const importBtn = this.modal.querySelector("#fbblocked-import-btn");
    const stopBtn = this.modal.querySelector("#fbblocked-stop-btn");
    const progressContainer = this.modal.querySelector(
      "#fbblocked-progress-container"
    );

    this.importCancelled = false;
    exportBtn.disabled = true;
    importBtn.disabled = true;
    stopBtn.classList.add("active");
    progressContainer.style.display = "block";

    try {
      this.log(`Starting import for page: ${page.name}`, "info");

      // Read file
      const content = await this.fileHelper.readTextFile(file);
      const lines = content.split("\n").filter((line) => line.trim());

      // Extract user IDs
      const userIds = [];
      const idRegex = /\d+/;
      for (const line of lines) {
        const match = idRegex.exec(line);
        if (match) {
          userIds.push(match[0]);
        }
      }

      this.log(`Found ${userIds.length} user IDs in file`, "info");

      if (userIds.length === 0) {
        throw new Error("No valid user IDs found in file");
      }

      // Ensure we're on main profile
      const currentProfile = this.api.getCurrentProfile();
      if (currentProfile) {
        this.log(`Currently on page profile, switching to main...`, "warning");
        const mainUser = await this.api.getMainUser();
        await this.api.switchProfile(currentProfile, mainUser.id);
        await this.sleep(1000);
        this.log(`Switched to main profile`, "info");
      }

      // Create batches
      const batchSize = 100;
      const batches = [];
      for (let i = 0; i < userIds.length; i += batchSize) {
        batches.push(userIds.slice(i, i + batchSize));
      }

      this.log(`Created ${batches.length} batches (max ${batchSize} users each)`, "info");

      // Process batches
      let processedUsers = 0;

      for (let i = 0; i < batches.length; i++) {
        // Check if cancelled
        if (this.importCancelled) {
          this.log(
            `🛑 Import cancelled by user at batch ${i + 1}/${batches.length}`,
            "warning"
          );
          break;
        }

        const batch = batches[i];
        const progress = ((i + 1) / batches.length) * 100;

        this.updateProgress(
          progress,
          `Sending batch ${i + 1} of ${batches.length} (${batch.length} users)`
        );

        this.log(
          `📤 Batch ${i + 1}/${batches.length} sent (${batch.length} users)`,
          "info"
        );

        // Send batch without checking result
        try {
          await this.api.blockUsers(
            page.id,
            page.access_token,
            batch
          );
          processedUsers += batch.length;
        } catch (error) {
          // Log error but continue
          this.log(
            `⚠️ Batch ${i + 1} API error (continuing anyway): ${error.message}`,
            "warning"
          );
          processedUsers += batch.length;
        }

        // Small delay between batches
        await this.sleep(500);
      }

      if (this.importCancelled) {
        this.log(
          `Import stopped. Total users sent: ${processedUsers}`,
          "warning"
        );
      } else {
        this.log(
          `✅ Import complete! Total users sent: ${processedUsers}`,
          "info"
        );
      }
    } catch (error) {
      this.log(`❌ Import failed: ${error.message}`, "error");
      console.error(error);
    } finally {
      exportBtn.disabled = false;
      importBtn.disabled = false;
      stopBtn.classList.remove("active");
      progressContainer.style.display = "none";
      this.importCancelled = false;
    }
  }

  cancelImport() {
    if (confirm("Are you sure you want to stop the import?")) {
      this.importCancelled = true;
      this.log("Cancellation requested, stopping after current batch...", "warning");
    }
  }

  updateProgress(percentage, text) {
    const fill = this.modal.querySelector("#fbblocked-progress-fill");
    const textEl = this.modal.querySelector("#fbblocked-progress-text");

    fill.style.width = `${percentage}%`;
    fill.textContent = `${Math.round(percentage)}%`;
    textEl.textContent = text;
  }

  log(message, type = "info") {
    const logEl = this.modal.querySelector("#fbblocked-log");
    const entry = document.createElement("div");
    entry.className = `fbblocked-log-entry fbblocked-log-${type}`;
    entry.innerHTML = `<span class="fbblocked-log-time">[${this.getTime()}]</span> ${message}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  getTime() {
    const now = new Date();
    return now.toLocaleTimeString("en-US", { hour12: false });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  close() {
    if (this.modal) {
      document.body.removeChild(this.modal);
    }
  }

  async show() {
    await this.createModal();
  }
}

// Main execution
(async function () {
  try {
    const api = new BlockedUsersAPI();
    const fileHelper = new FileHelper();
    const ui = new UIManager(api, fileHelper);
    await ui.show();
  } catch (error) {
    console.error("FB Blocked Manager Error:", error);
    alert(`Error: ${error.message}`);
  }
})();

    // Создаем плавающую кнопку в нижнем левом углу ФБ
    function createTriggerButton() {
        if (document.getElementById('fb-blocker-trigger')) return;

        const btn = document.createElement('button');
        btn.id = 'fb-blocker-trigger';
        btn.innerText = '🚨 БанFB';
        btn.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            z-index: 999999;
            background: #ff5722;
            color: white;
            border: none;
            border-radius: 8px;
            padding: 10px 15px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        `;
        
        btn.onclick = async () => {
            try {
                const api = new BlockedUsersAPI();
                const fileHelper = new FileHelper();
                const ui = new UIManager(api, fileHelper);
                await ui.show();
            } catch (error) {
                console.error("FB Blocked Manager Error:", error);
                alert(`Error: ${error.message}`);
            }
        };

        document.body.appendChild(btn);
    }

    // Ждем загрузки страницы и добавляем кнопку
    window.addEventListener('load', createTriggerButton);
    setTimeout(createTriggerButton, 3000); // Резервный запуск для SPA-архитектуры ФБ
})();
