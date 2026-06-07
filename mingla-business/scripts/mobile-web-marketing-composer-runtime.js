function renderMarketingComposerRoute(path, session, chosen, uid, email) {
  var token = session.access_token;
  var accountId = uid || session.user && session.user.id || null;
  var brand = chosen;
  var params = new URLSearchParams(location.search || "");
  var state = {
    accountId: accountId,
    brandId: brand && brand.id || null,
    brandName: brand && brand.name || "Your brand",
    audienceId: null,
    audienceName: null,
    audienceCount: null,
    campaignId: null,
    templateId: params.get("template"),
    subject: "",
    bodyHtml: "",
    scheduledFor: "",
    sendMode: "now",
    templates: [],
    audiences: [],
    events: [],
    loading: true,
    saving: false,
    submitting: false,
    dirty: false,
    lastSavedAt: null,
    error: null,
    success: null,
    activePanel: "composer"
  };
  var saveTimer = null;
  var loadTimer = setTimeout(function () {
    if (state.loading) {
      state.loading = false;
      state.error = "This is taking longer than expected. Check your connection and retry.";
      render();
    }
  }, 8000);
  var COLUMNS = "id, account_id, brand_id, audience_id, template_id, name, channel, channel_payload, status, scheduled_for, sent_at, recipient_count, created_at, updated_at";

  function composerRest(table, params, options) {
    var method = options && options.method || "GET";
    var body = options && options.body;
    var prefer = options && options.prefer;
    var url = sbUrl + "/rest/v1/" + table + (params ? "?" + params : "");
    var headers = {
      apikey: sbAnon,
      Authorization: "Bearer " + token,
      Accept: "application/json"
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers.Prefer = prefer;
    return fetch(url, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (response) {
      return response.text().then(function (text) {
        var json = text ? JSON.parse(text) : null;
        if (!response.ok) {
          var message = json && (json.message || json.error_description || json.error) || "HTTP " + response.status;
          throw new Error(message);
        }
        return json;
      });
    });
  }

  function queryValue(value) {
    return encodeURIComponent(String(value));
  }

  function bodyText(html) {
    return String(html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeBodyHtml(value) {
    return esc(value).replace(/\n/g, "<br>");
  }

  function editorHtmlToTokenString() {
    var editor = document.getElementById("orch1096-body");
    if (!editor) return state.bodyHtml;
    var clone = editor.cloneNode(true);
    clone.querySelectorAll("[data-token]").forEach(function (node) {
      var tokenName = node.getAttribute("data-token") || "first_name";
      node.replaceWith(document.createTextNode("{" + tokenName + "}"));
    });
    clone.querySelectorAll("[data-event-id]").forEach(function (node) {
      var eventId = node.getAttribute("data-event-id") || "";
      node.replaceWith(document.createTextNode("{{event:" + eventId + "}}"));
    });
    return clone.innerHTML
      .replace(/<div><br><\/div>/g, "\n")
      .replace(/<div>/g, "\n")
      .replace(/<\/div>/g, "")
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/&nbsp;/g, " ");
  }

  function tokenStringToEditorHtml(value) {
    return escapeBodyHtml(value || "")
      .replace(/\{(first_name|brand_name|event_name|event_date|event_time|doors_open|event_url|spots_left|previous_event_name|next_event_name|event_id)\}/g, function (_match, tokenName) {
        return '<span class="orch1096-chip" contenteditable="false" data-token="' + esc(tokenName) + '" data-orch-1096-personalization-chip="true">{' + esc(tokenName) + "}</span>";
      })
      .replace(/\{\{event:([0-9a-fA-F-]{36})(?:\|(compact|medium|large))?\}\}/g, function (_match, eventId) {
        var event = state.events.find(function (candidate) { return candidate.id === eventId; });
        var label = event && event.title || "Event";
        return '<span class="orch1096-event-chip" contenteditable="false" data-event-id="' + esc(eventId) + '" data-orch-1096-event-chip="true">Event: ' + esc(label) + "</span>";
      });
  }

  function embeddedEventIds() {
    var ids = [];
    var re = /\{\{event:([0-9a-fA-F-]{36})(?:\|(compact|medium|large))?\}\}/g;
    var match;
    while ((match = re.exec(state.bodyHtml)) !== null) {
      if (ids.indexOf(match[1]) === -1) ids.push(match[1]);
    }
    return ids;
  }

  function channelPayload() {
    return {
      kind: "email",
      subject: state.subject,
      body_html: state.bodyHtml,
      body_text: bodyText(state.bodyHtml),
      embedded_events: embeddedEventIds()
    };
  }

  function createDraft() {
    if (!state.accountId || !state.brandId || !state.audienceId) {
      return Promise.reject(new Error("Pick an audience before saving a draft."));
    }
    return composerRest(
      "marketing_campaigns",
      "select=" + encodeURIComponent(COLUMNS),
      {
        method: "POST",
        prefer: "return=representation",
        body: {
          account_id: state.accountId,
          brand_id: state.brandId,
          audience_id: state.audienceId,
          template_id: state.templateId || undefined,
          name: state.subject.trim() || "Untitled campaign",
          channel: "email",
          channel_payload: channelPayload(),
          status: "draft"
        }
      }
    ).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row || !row.id) throw new Error("createDraft: insert returned no row");
      state.campaignId = row.id;
      return row;
    });
  }

  function updateDraft() {
    if (!state.campaignId) return createDraft();
    return composerRest(
      "marketing_campaigns",
      "id=eq." + queryValue(state.campaignId) + "&status=eq.draft&select=" + encodeURIComponent(COLUMNS),
      {
        method: "PATCH",
        prefer: "return=representation",
        body: {
          name: state.subject.trim() || "Untitled campaign",
          audience_id: state.audienceId,
          channel: "email",
          channel_payload: channelPayload(),
          updated_at: new Date().toISOString()
        }
      }
    ).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row || !row.id) throw new Error("updateDraft: no draft row updated");
      return row;
    });
  }

  function scheduleSend() {
    if (!state.campaignId) return Promise.reject(new Error("Save the draft before scheduling."));
    var scheduledFor = state.sendMode === "now" ? new Date().toISOString() : new Date(state.scheduledFor).toISOString();
    return composerRest(
      "marketing_campaigns",
      "id=eq." + queryValue(state.campaignId) + "&status=in.(draft,scheduled)&select=" + encodeURIComponent(COLUMNS),
      {
        method: "PATCH",
        prefer: "return=representation",
        body: {
          name: state.subject.trim() || "Untitled campaign",
          channel: "email",
          channel_payload: channelPayload(),
          status: "scheduled",
          scheduled_for: scheduledFor,
          updated_at: new Date().toISOString()
        }
      }
    ).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row || !row.id) throw new Error("scheduleSend: no row updated");
      return row;
    });
  }

  function scheduledDateValue() {
    if (!state.scheduledFor) return null;
    var date = new Date(state.scheduledFor);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function scheduledTimeIsFuture() {
    var date = scheduledDateValue();
    return date !== null && date.getTime() > Date.now();
  }

  function cancelPendingAutosave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  function autosaveBlocked() {
    return state.submitting || state.activePanel === "success";
  }

  function ensureAudience(kind, targetId) {
    var existingParams = "select=id,query_definition&brand_id=eq." + queryValue(state.brandId) + "&is_system_generated=eq.true";
    return composerRest("marketing_audiences", existingParams).then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      for (var i = 0; i < rows.length; i += 1) {
        var q = rows[i].query_definition || {};
        if (kind === "brand_buyers" && q.kind === "brand_buyers" && q.brand_id === targetId) return rows[i].id;
        if (kind === "event_buyers" && q.kind === "event_buyers" && q.event_id === targetId) return rows[i].id;
      }
      var queryDefinition = kind === "brand_buyers"
        ? { kind: "brand_buyers", brand_id: targetId, payment_statuses: ["paid", "partial_refund"] }
        : { kind: "event_buyers", event_id: targetId, payment_statuses: ["paid", "partial_refund"] };
      return composerRest(
        "marketing_audiences",
        "select=id",
        {
          method: "POST",
          prefer: "return=representation",
          body: {
            account_id: state.accountId,
            brand_id: state.brandId,
            name: kind === "brand_buyers" ? "All brand buyers" : "Event buyers",
            query_definition: queryDefinition,
            is_system_generated: true
          }
        }
      ).then(function (inserted) {
        var row = Array.isArray(inserted) ? inserted[0] : inserted;
        if (!row || !row.id) throw new Error("Could not create audience.");
        return row.id;
      });
    });
  }

  function loadAudiences() {
    var orderParams = "select=event_id,events!inner(id,title,brand_id)&payment_status=in.(paid,partial_refund)&events.brand_id=eq." + queryValue(state.brandId);
    var existingParams = "select=id,query_definition&brand_id=eq." + queryValue(state.brandId);
    return Promise.all([
      composerRest("orders", orderParams).catch(function () { return []; }),
      composerRest("marketing_audiences", existingParams).catch(function () { return []; })
    ]).then(function (results) {
      var orders = Array.isArray(results[0]) ? results[0] : [];
      var existing = Array.isArray(results[1]) ? results[1] : [];
      var brandAudienceId = null;
      var eventAudienceIds = {};
      existing.forEach(function (row) {
        var q = row.query_definition || {};
        if (q.kind === "brand_buyers" && q.brand_id === state.brandId) brandAudienceId = row.id;
        if (q.kind === "event_buyers" && q.event_id) eventAudienceIds[q.event_id] = row.id;
      });
      var perEvent = {};
      orders.forEach(function (order) {
        var eventId = order.events && order.events.id || order.event_id;
        var title = order.events && order.events.title || "Untitled event";
        if (!perEvent[eventId]) perEvent[eventId] = { title: title, count: 0 };
        perEvent[eventId].count += 1;
      });
      var options = [{
        key: "brand:" + state.brandId,
        name: "All buyers of " + state.brandName,
        kind: "brand_buyers",
        targetId: state.brandId,
        count: orders.length,
        existingAudienceId: brandAudienceId
      }];
      Object.keys(perEvent).forEach(function (eventId) {
        options.push({
          key: "event:" + eventId,
          name: "Buyers of " + perEvent[eventId].title,
          kind: "event_buyers",
          targetId: eventId,
          count: perEvent[eventId].count,
          existingAudienceId: eventAudienceIds[eventId] || null
        });
      });
      state.audiences = options;
    });
  }

  function loadTemplates() {
    var cols = "id,account_id,brand_id,name,channel,subject_template,body_template,is_starter_pack,created_at,updated_at";
    return Promise.all([
      composerRest("marketing_templates", "select=" + cols + "&is_starter_pack=eq.true&channel=eq.email&order=created_at.asc").catch(function () { return []; }),
      composerRest("marketing_templates", "select=" + cols + "&is_starter_pack=eq.false&account_id=eq." + queryValue(state.accountId) + "&order=updated_at.desc").catch(function () { return []; })
    ]).then(function (results) {
      state.templates = (Array.isArray(results[0]) ? results[0] : []).concat(Array.isArray(results[1]) ? results[1] : []);
    });
  }

  function loadEvents() {
    var eventParams = "select=id,title,master_start_at,master_end_at,master_timezone,cover_media_url&brand_id=eq." + queryValue(state.brandId) + "&deleted_at=is.null&order=master_start_at.desc.nullslast&limit=50";
    return composerRest("events_with_master_date_view", eventParams).then(function (rows) {
      state.events = (Array.isArray(rows) ? rows : []).map(function (row) {
        return {
          id: row.id,
          title: row.title || "Untitled event",
          dateLabel: row.master_start_at ? fmtDate(row.master_start_at) : "",
          coverUrl: row.cover_media_url || null
        };
      });
    }).catch(function () {
      state.events = [];
    });
  }

  function hydrateDraft(draftId) {
    if (!draftId) return Promise.resolve();
    return composerRest("marketing_campaigns", "select=" + encodeURIComponent(COLUMNS) + "&id=eq." + queryValue(draftId)).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw new Error("Couldn't load draft. Start fresh below.");
      state.campaignId = row.id;
      state.audienceId = row.audience_id;
      state.templateId = row.template_id || state.templateId;
      state.scheduledFor = row.scheduled_for || "";
      if (row.scheduled_for) state.sendMode = "schedule";
      if (row.channel_payload && row.channel_payload.kind === "email") {
        state.subject = row.channel_payload.subject || "";
        state.bodyHtml = row.channel_payload.body_html || "";
      }
    });
  }

  function hydrateTemplate(templateId) {
    if (!templateId || params.get("draft")) return Promise.resolve();
    return composerRest("marketing_templates", "select=id,subject_template,body_template&id=eq." + queryValue(templateId)).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return;
      state.subject = row.subject_template || "";
      state.bodyHtml = row.body_template || "";
      state.dirty = true;
    }).catch(function (error) {
      state.error = error.message || "Couldn't load template.";
    });
  }

  function hydrateAudience(audienceParam) {
    if (!audienceParam) return Promise.resolve();
    var bits = audienceParam.split(":");
    if (bits.length !== 2) return Promise.resolve();
    var kind = bits[0] === "event" ? "event_buyers" : "brand_buyers";
    var targetId = bits[1];
    return ensureAudience(kind, targetId).then(function (audienceId) {
      state.audienceId = audienceId;
      state.audienceName = kind === "brand_buyers" ? "All brand buyers" : "Event buyers";
    }).catch(function (error) {
      state.error = error.message || "Couldn't load audience. Pick one below.";
    });
  }

  function validationMessage() {
    if (!state.audienceId) return "Pick an audience before sending.";
    if (!state.subject.trim()) return "Add a subject before sending.";
    if (!bodyText(state.bodyHtml)) return "Write a message before sending.";
    if (state.sendMode === "schedule") {
      if (!state.scheduledFor) return "Pick a send time.";
      if (scheduledDateValue() === null) return "Pick a valid send time.";
      if (!scheduledTimeIsFuture()) return "Pick a send time in the future.";
    }
    return null;
  }

  function syncFieldsFromDom() {
    var subject = document.getElementById("orch1096-subject");
    if (subject) state.subject = subject.value;
    state.bodyHtml = editorHtmlToTokenString();
  }

  function markDirty() {
    state.dirty = true;
    state.success = null;
    cancelPendingAutosave();
    if (autosaveBlocked()) {
      updateStatusOnly();
      return;
    }
    saveTimer = setTimeout(function () {
      saveTimer = null;
      void saveDraft(false, { autosave: true });
    }, 800);
    updateStatusOnly();
  }

  function updateStatusOnly() {
    var status = document.getElementById("orch1096-status");
    if (!status) return;
    status.textContent = state.saving
      ? "Saving draft..."
      : state.lastSavedAt
        ? "Draft saved " + new Date(state.lastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : state.dirty
          ? "Unsaved changes"
          : "Ready";
  }

  function saveDraft(showSuccess, options) {
    if (options && options.autosave && autosaveBlocked()) return Promise.resolve();
    cancelPendingAutosave();
    syncFieldsFromDom();
    if (state.saving) return Promise.resolve();
    state.saving = true;
    state.error = null;
    render();
    return (state.campaignId ? updateDraft() : createDraft())
      .then(function () {
        state.dirty = false;
        state.lastSavedAt = new Date().toISOString();
        if (showSuccess) state.success = "Draft saved. You can refresh and return to this campaign.";
      })
      .catch(function (error) {
        state.error = error.message || "Couldn't save draft. Tap Save draft to retry.";
      })
      .finally(function () {
        state.saving = false;
        render();
      });
  }

  function insertHtml(html) {
    var editor = document.getElementById("orch1096-body");
    if (!editor) return;
    editor.focus();
    document.execCommand("insertHTML", false, html);
    markDirty();
  }

  function applyTemplate(id) {
    var tmpl = state.templates.find(function (candidate) { return candidate.id === id; });
    if (!tmpl) return;
    state.templateId = tmpl.id;
    state.subject = tmpl.subject_template || state.subject;
    state.bodyHtml = tmpl.body_template || state.bodyHtml;
    state.dirty = true;
    state.activePanel = "composer";
    render();
  }

  function pickAudience(key) {
    var option = state.audiences.find(function (candidate) { return candidate.key === key; });
    if (!option) return;
    state.error = null;
    state.audienceName = option.name;
    state.audienceCount = option.count;
    state.activePanel = "composer";
    state.dirty = true;
    render();
    var ready = option.existingAudienceId
      ? Promise.resolve(option.existingAudienceId)
      : ensureAudience(option.kind, option.targetId);
    ready.then(function (audienceId) {
      state.audienceId = audienceId;
      state.audienceName = option.name;
      state.audienceCount = option.count;
      render();
      markDirty();
    }).catch(function (error) {
      state.error = error.message || "Couldn't load that audience. Pick another or retry.";
      render();
    });
  }

  function openReview(mode) {
    syncFieldsFromDom();
    state.sendMode = mode;
    var date = document.getElementById("orch1096-date");
    var time = document.getElementById("orch1096-time");
    if (mode === "schedule" && date && time && date.value && time.value) {
      state.scheduledFor = new Date(date.value + "T" + time.value).toISOString();
    }
    var message = validationMessage();
    if (message !== null) {
      state.error = message;
      render();
      return;
    }
    state.activePanel = "review";
    render();
  }

  function confirmSchedule() {
    syncFieldsFromDom();
    var message = validationMessage();
    if (message !== null) {
      state.error = message;
      state.activePanel = "composer";
      render();
      return;
    }
    cancelPendingAutosave();
    state.submitting = true;
    state.error = null;
    render();
    var ensureSaved = state.dirty || !state.campaignId ? saveDraft(false) : Promise.resolve();
    ensureSaved.then(function () {
      return scheduleSend();
    }).then(function () {
      state.submitting = false;
      state.dirty = false;
      state.success = state.sendMode === "now"
        ? "Campaign queued to send now."
        : "Campaign scheduled for " + formatScheduledLabel() + ".";
      state.activePanel = "success";
      cancelPendingAutosave();
      render();
    }).catch(function (error) {
      state.submitting = false;
      state.error = error.message || "Couldn't schedule. Tap Schedule again to retry.";
      render();
    });
  }

  function formatScheduledLabel() {
    if (state.sendMode === "now") return "Send immediately";
    if (!state.scheduledFor) return "Pick a time";
    try {
      return new Date(state.scheduledFor).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (_e) {
      return "Pick a time";
    }
  }

  function iconButton(label, text, attrs) {
    return '<button type="button" aria-label="' + esc(label) + '" ' + (attrs || "") + ' style="min-width:44px;min-height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#fff;font-weight:800">' + esc(text) + "</button>";
  }

  function chipButton(label, attrs) {
    return '<button type="button" ' + attrs + ' style="min-height:44px;border-radius:999px;border:1px solid rgba(235,120,37,.35);background:rgba(235,120,37,.14);color:#fff;padding:0 13px;font-weight:800">' + esc(label) + "</button>";
  }

  function panelButton(label, panel, marker) {
    var active = state.activePanel === panel;
    return '<button type="button" data-panel="' + panel + '" ' + marker + ' style="min-height:44px;border-radius:999px;border:1px solid ' + (active ? "#eb7825" : "rgba(255,255,255,.14)") + ';background:' + (active ? "rgba(235,120,37,.2)" : "rgba(255,255,255,.07)") + ';color:#fff;padding:0 14px;font-weight:800">' + esc(label) + "</button>";
  }

  function routeStyles() {
    return '<style id="orch1096-style">.orch1096-field{box-sizing:border-box;width:100%;min-height:46px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;padding:0 12px;font:inherit}.orch1096-label{display:block;margin:0 0 7px;color:rgba(255,255,255,.72);font-size:13px;font-weight:800}.orch1096-body{box-sizing:border-box;width:100%;min-height:210px;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;padding:13px;font:inherit;line-height:1.45;outline:none;overflow-wrap:anywhere}.orch1096-body:focus,.orch1096-field:focus{border-color:#eb7825;box-shadow:0 0 0 3px rgba(235,120,37,.18)}.orch1096-chip,.orch1096-event-chip{display:inline-block;margin:0 2px;padding:2px 8px;border-radius:999px;border:1px solid rgba(235,120,37,.45);background:rgba(235,120,37,.16);color:#fff;white-space:nowrap}.orch1096-event-chip{background:rgba(255,255,255,.1)}.orch1096-row{width:100%;min-height:54px;text-align:left;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#fff;padding:10px 12px}.orch1096-row+button{margin-top:8px}.orch1096-grid{display:grid;grid-template-columns:1fr;gap:10px}@media (min-width:768px){.orch1096-grid{grid-template-columns:minmax(0,1fr) 340px}.orch1096-editor-card{min-height:640px}}</style>';
  }

  function panelHtml() {
    if (state.activePanel === "audience") {
      var rows = state.audiences.map(function (option) {
        return '<button type="button" class="orch1096-row" data-audience-key="' + esc(option.key) + '" data-orch-1096-audience-picker="true"><strong>' + esc(option.name) + '</strong><br><span style="color:rgba(255,255,255,.68)">' + esc(option.count) + " " + (option.count === 1 ? "buyer" : "buyers") + " · " + (option.kind === "brand_buyers" ? "Brand rollup" : "Event buyers") + "</span></button>";
      }).join("");
      return card('<h2 style="margin:0 0 10px;font-size:18px">Audience</h2>' + (rows || '<p style="margin:0;color:rgba(255,255,255,.72)">No paid buyers yet. Audiences appear as tickets sell.</p>'));
    }
    if (state.activePanel === "templates") {
      var templateRows = state.templates.map(function (tmpl) {
        return '<button type="button" class="orch1096-row" data-template-id="' + esc(tmpl.id) + '" data-orch-1096-template-drawer="true"><strong>' + esc(tmpl.name || "Untitled template") + '</strong><br><span style="color:rgba(255,255,255,.68)">' + esc(tmpl.subject_template || "No subject") + "</span></button>";
      }).join("");
      return card('<h2 style="margin:0 0 10px;font-size:18px">Templates</h2>' + (templateRows || '<p style="margin:0;color:rgba(255,255,255,.72)">No templates yet. Write from scratch or save this draft.</p>'));
    }
    if (state.activePanel === "chips") {
      var eventRows = state.events.map(function (event) {
        return chipButton(event.title, 'data-event-id-insert="' + esc(event.id) + '" data-event-label="' + esc(event.title) + '" data-orch-1096-event-chip="true"');
      }).join("");
      return card('<h2 style="margin:0 0 10px;font-size:18px">Chips</h2><p style="margin:0 0 10px;color:rgba(255,255,255,.72)">Insert personalization or event cards into the message.</p><div style="display:flex;flex-wrap:wrap;gap:8px">' + chipButton("{first_name}", 'data-token-insert="first_name" data-orch-1096-personalization-chip="true"') + chipButton("{brand_name}", 'data-token-insert="brand_name" data-orch-1096-personalization-chip="true"') + chipButton("{event_name}", 'data-token-insert="event_name" data-orch-1096-personalization-chip="true"') + '</div><h3 style="margin:16px 0 8px;font-size:15px">Events</h3><div style="display:flex;flex-wrap:wrap;gap:8px">' + (eventRows || '<span style="color:rgba(255,255,255,.72)">No events to insert yet.</span>') + "</div>");
    }
    if (state.activePanel === "preview") {
      return card('<h2 style="margin:0 0 10px;font-size:18px" data-orch-1096-preview="true">Inbox preview</h2><div style="border-radius:12px;background:#fff;color:#111;padding:14px"><p style="margin:0 0 8px;color:#666;font-size:12px">From ' + esc(state.brandName) + '</p><h3 style="margin:0 0 12px;font-size:20px">' + esc(state.subject || "Untitled campaign") + '</h3><div style="line-height:1.45">' + tokenStringToEditorHtml(state.bodyHtml || "Your message preview appears here.") + '</div></div>');
    }
    if (state.activePanel === "schedule") {
      var now = new Date(Date.now() + 3600000);
      var dateValue = state.scheduledFor ? new Date(state.scheduledFor).toISOString().slice(0, 10) : now.toISOString().slice(0, 10);
      var timeValue = state.scheduledFor ? new Date(state.scheduledFor).toTimeString().slice(0, 5) : now.toTimeString().slice(0, 5);
      return card('<h2 style="margin:0 0 10px;font-size:18px" data-orch-1096-schedule-picker="true">Schedule</h2><label class="orch1096-label" for="orch1096-date">Date</label><input id="orch1096-date" class="orch1096-field" type="date" value="' + esc(dateValue) + '"><label class="orch1096-label" for="orch1096-time" style="margin-top:12px">Time</label><input id="orch1096-time" class="orch1096-field" type="time" value="' + esc(timeValue) + '"><button type="button" id="orch1096-open-review" style="width:100%;min-height:46px;margin-top:14px;border-radius:12px;border:1px solid #eb7825;background:#eb7825;color:#111;font-weight:900">Review schedule</button>');
    }
    if (state.activePanel === "review") {
      return card('<h2 style="margin:0 0 10px;font-size:18px" data-orch-1096-review="true">Review campaign</h2><p style="margin:0 0 8px;color:rgba(255,255,255,.72)">Audience: <strong style="color:#fff">' + esc(state.audienceName || "Selected audience") + '</strong></p><p style="margin:0 0 8px;color:rgba(255,255,255,.72)">Subject: <strong style="color:#fff">' + esc(state.subject) + '</strong></p><p style="margin:0 0 12px;color:rgba(255,255,255,.72)">When: <strong style="color:#fff">' + esc(formatScheduledLabel()) + '</strong></p><button type="button" id="orch1096-confirm" style="width:100%;min-height:46px;border-radius:12px;border:1px solid #eb7825;background:#eb7825;color:#111;font-weight:900">' + (state.submitting ? "Scheduling..." : state.sendMode === "now" ? "Queue send now" : "Schedule campaign") + "</button>");
    }
    if (state.activePanel === "success") {
      return card('<h2 style="margin:0 0 10px;font-size:18px">Campaign ready</h2><p style="margin:0;color:rgba(255,255,255,.72)">' + esc(state.success || "Campaign saved.") + "</p>" + btn("/marketing", "Return to marketing", true));
    }
    return "";
  }

  function render() {
    if (state.loading) {
      page("Compose blast", card('<p style="margin:0;color:rgba(255,255,255,.72)">Loading your audience, templates, drafts, and events.</p><p style="margin:12px 0 0;color:rgba(255,255,255,.5)">This route stays outside the full app boot on phone browsers.</p>'));
      return;
    }
    var statusCopy = state.saving
      ? "Saving draft..."
      : state.lastSavedAt
        ? "Draft saved"
        : state.dirty
          ? "Unsaved changes"
          : "Ready";
    var alert = state.error
      ? '<div role="alert" style="border:1px solid rgba(255,100,100,.35);background:rgba(255,80,80,.12);border-radius:12px;padding:10px;margin:0 0 12px;color:#fff">' + esc(state.error) + "</div>"
      : state.success
        ? '<div role="status" style="border:1px solid rgba(110,220,160,.35);background:rgba(80,180,120,.14);border-radius:12px;padding:10px;margin:0 0 12px;color:#fff">' + esc(state.success) + "</div>"
        : "";
    var panelNav = '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;margin:0 0 10px">' +
      panelButton("Audience", "audience", 'data-orch-1096-audience-picker="true"') +
      panelButton("Templates", "templates", 'data-orch-1096-template-drawer="true"') +
      panelButton("Chips", "chips", 'data-orch-1096-personalization-chip="true"') +
      panelButton("Preview", "preview", 'data-orch-1096-preview="true"') +
      panelButton("Schedule", "schedule", 'data-orch-1096-schedule-picker="true"') +
      "</div>";
    var composer = '<section class="orch1096-editor-card" style="border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(255,255,255,.075);padding:14px" data-orch-1096-browser-composer="true">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px"><div><p style="margin:0;color:rgba(255,255,255,.62);font-size:12px">To</p><strong>' + esc(state.audienceName || "Pick an audience") + '</strong></div><span id="orch1096-status" style="color:rgba(255,255,255,.62);font-size:12px">' + esc(statusCopy) + "</span></div>" +
      '<label class="orch1096-label" for="orch1096-subject">Subject</label><input id="orch1096-subject" class="orch1096-field" aria-label="Campaign subject" value="' + esc(state.subject) + '" placeholder="What should buyers know?">' +
      '<div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">' + iconButton("Bold", "B", 'data-command="bold"') + iconButton("Italic", "I", 'data-command="italic"') + iconButton("Underline", "U", 'data-command="underline"') + iconButton("Add link", "Link", 'data-command="link"') + "</div>" +
      '<label class="orch1096-label" for="orch1096-body">Message</label><div id="orch1096-body" class="orch1096-body" aria-label="Campaign message body" role="textbox" contenteditable="true" data-placeholder="Write your blast...">' + tokenStringToEditorHtml(state.bodyHtml) + "</div>" +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px"><button type="button" id="orch1096-save" data-orch-1096-save-draft="true" style="min-height:46px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.1);color:#fff;font-weight:900">Save draft</button><button type="button" id="orch1096-send-now" style="min-height:46px;border-radius:12px;border:1px solid #eb7825;background:#eb7825;color:#111;font-weight:900">Send now</button></div>' +
      "</section>";
    page("Compose blast", routeStyles() + alert + panelNav + '<div class="orch1096-grid">' + composer + '<aside>' + panelHtml() + "</aside></div>");
    wire();
  }

  function wire() {
    var subject = document.getElementById("orch1096-subject");
    var body = document.getElementById("orch1096-body");
    if (subject) subject.addEventListener("input", function () { state.subject = subject.value; markDirty(); });
    if (body) body.addEventListener("input", function () { state.bodyHtml = editorHtmlToTokenString(); markDirty(); });
    document.querySelectorAll("[data-panel]").forEach(function (node) {
      node.addEventListener("click", function () {
        syncFieldsFromDom();
        state.activePanel = node.getAttribute("data-panel") || "composer";
        render();
      });
    });
    document.querySelectorAll("[data-command]").forEach(function (node) {
      node.addEventListener("click", function () {
        var cmd = node.getAttribute("data-command");
        if (cmd === "link") {
          var href = window.prompt("Paste a link");
          if (href) document.execCommand("createLink", false, href);
        } else {
          document.execCommand(cmd, false);
        }
        markDirty();
      });
    });
    document.querySelectorAll("[data-token-insert]").forEach(function (node) {
      node.addEventListener("click", function () {
        var tokenName = node.getAttribute("data-token-insert") || "first_name";
        insertHtml('<span class="orch1096-chip" contenteditable="false" data-token="' + esc(tokenName) + '" data-orch-1096-personalization-chip="true">{' + esc(tokenName) + "}</span>&nbsp;");
      });
    });
    document.querySelectorAll("[data-event-id-insert]").forEach(function (node) {
      node.addEventListener("click", function () {
        var eventId = node.getAttribute("data-event-id-insert") || "";
        var label = node.getAttribute("data-event-label") || "Event";
        insertHtml('<span class="orch1096-event-chip" contenteditable="false" data-event-id="' + esc(eventId) + '" data-orch-1096-event-chip="true">Event: ' + esc(label) + "</span>&nbsp;");
      });
    });
    document.querySelectorAll("[data-template-id]").forEach(function (node) {
      node.addEventListener("click", function () { applyTemplate(node.getAttribute("data-template-id") || ""); });
    });
    document.querySelectorAll("[data-audience-key]").forEach(function (node) {
      node.addEventListener("click", function () { pickAudience(node.getAttribute("data-audience-key") || ""); });
    });
    var save = document.getElementById("orch1096-save");
    if (save) save.addEventListener("click", function () { void saveDraft(true); });
    var sendNow = document.getElementById("orch1096-send-now");
    if (sendNow) sendNow.addEventListener("click", function () { openReview("now"); });
    var review = document.getElementById("orch1096-open-review");
    if (review) review.addEventListener("click", function () { openReview("schedule"); });
    var confirm = document.getElementById("orch1096-confirm");
    if (confirm) confirm.addEventListener("click", confirmSchedule);
  }

  Promise.all([loadAudiences(), loadTemplates(), loadEvents()])
    .then(function () {
      return hydrateDraft(params.get("draft"));
    })
    .then(function () {
      return hydrateTemplate(state.templateId);
    })
    .then(function () {
      return hydrateAudience(params.get("audience"));
    })
    .then(function () {
      if (!state.audienceId && state.audiences.length > 0) {
        state.audienceName = "Pick an audience";
      }
      clearTimeout(loadTimer);
      state.loading = false;
      render();
    })
    .catch(function (error) {
      clearTimeout(loadTimer);
      state.loading = false;
      state.error = error.message || "Could not load the composer.";
      render();
    });
}
