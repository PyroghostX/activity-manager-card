import {
    LitElement,
    html,
    css,
    repeat
} from "/local/community/activity-manager-card/lit-all.min.js";

export const utils = {
    _formatTimeAgo: (date) => {
        const formatter = new Intl.RelativeTimeFormat(undefined, {
            numeric: "auto",
        });

        const DIVISIONS = [
            { amount: 60, name: "seconds" },
            { amount: 60, name: "minutes" },
            { amount: 24, name: "hours" },
            { amount: 7, name: "days" },
            { amount: 4.34524, name: "weeks" },
            { amount: 12, name: "months" },
            { amount: Number.POSITIVE_INFINITY, name: "years" },
        ];
        let duration = (date - new Date()) / 1000;

        for (let i = 0; i < DIVISIONS.length; i++) {
            const division = DIVISIONS[i];
            if (Math.abs(duration) < division.amount) {
                return formatter.format(Math.round(duration), division.name);
            }
            duration /= division.amount;
        }
    },

    _getNumber: (value, defaultValue) => {
        const num = parseInt(value, 10);
        return isNaN(num) ? defaultValue : num;
    },

    // Date -> value for <input type="datetime-local"> (local time)
    _toLocalInput: (date) => {
        if (!(date instanceof Date) || isNaN(date.getTime())) date = new Date();
        const pad = (n) => n.toString().padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },

    // datetime-local value -> ISO with time zone, null if empty/invalid
    _localToIso: (value) => {
        const parsed = new Date(value);
        return value && !isNaN(parsed.getTime()) ? parsed.toISOString() : null;
    },
};

const CLOSE_PATH =
    "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z";

const ROTATION_OPTIONS = [
    ["alternate", "Take turns"],
    ["fixed", "Always the same person"],
    ["anyone", "Anyone"],
];

class ActivityManagerCard extends LitElement {
    _currentItem = null;
    _activities = [];
	_unsubscribe = null;
    // true once the integration answers activity_manager/history (edit,
    // history and sharing); false for an older integration
    _features = null;
    _featureProbe = null;
    _form = null; // values of the open Add/Edit form
    _history = [];
    _historyLoading = false;
    _doneBy = null; // person picked in the completion dialog
    _doneAt = ""; // datetime-local value in the completion dialog

    static getConfigElement() {
        return document.createElement("activity-manager-card-editor");
    }

    static getStubConfig() {
        return {
            category: "Activities",
        };
    }

    static get properties() {
        return {
            _hass: {},
            _config: {},
        };
    }

    setConfig(config) {
        this._config = structuredClone(config);
        this._config.header =
            this._config.header || this._config.category || "Activities";
        this._config.showDueOnly = config.showDueOnly || false;
        this._config.mode = config.mode || "basic";
        this._config.soonHours = config.soonHours || 24;
        this._config.icon = config.icon || "mdi:format-list-checkbox";

        this._runOnce = false;
        this._fetchData();
    }

    firstUpdated() {
        (async () => await loadHaForm())();
    }

	connectedCallback() {
		super.connectedCallback();
		
		// Detect if we're in a popup and add attribute
		if (this.closest('.bubble-pop-up-container') || this.closest('ha-dialog')) {
			this.setAttribute('in-popup', '');
		}
		
		// Apply button styling after connected
		setTimeout(() => this._applyCustomButtonStyling(), 100);

		// Re-attached after a view change: catch up and listen again
		if (this._hass && !this._unsubscribe) {
			this._fetchData();
			this._subscribe();
		}
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		if (this._unsubscribe) {
			this._unsubscribe
				.then((unsub) => unsub && unsub())
				.catch(() => {});
			this._unsubscribe = null;
		}
	}

    set hass(hass) {
        this._hass = hass;
        if (!this._runOnce) {
            // Update when loading
            this._fetchData();

            // Update when changes are made
            this._subscribe();

            this._runOnce = true;
        }
    }

    _subscribe() {
        if (this._unsubscribe || !this._hass) return;
        const refresh = () => this._fetchData();
        // activity_manager/subscribe works for every user. Home Assistant only
        // lets admins subscribe to the raw event, so it is just the fallback
        // for an older integration without the command.
        this._unsubscribe = this._hass.connection
            .subscribeMessage(refresh, { type: "activity_manager/subscribe" })
            .catch(() =>
                this._hass.user?.is_admin
                    ? this._hass.connection.subscribeEvents(
                          refresh,
                          "activity_manager_updated"
                      )
                    : null
            )
            .catch(() => null);
    }

    // Edit, history and sharing need a newer integration. An older one
    // answers unknown_command, and the card then works as before.
    _probeFeatures() {
        if (this._featureProbe || !this._hass) return;
        this._featureProbe = this._hass
            .callWS({ type: "activity_manager/history", limit: 1 })
            .then(() => true)
            .catch((err) => {
                // Ask again on the next refresh unless the command is missing
                if (err?.code !== "unknown_command") this._featureProbe = null;
                return false;
            })
            .then((ok) => {
                this._features = ok;
                this.requestUpdate();
            });
    }

    // --- People ---------------------------------------------------------

    _persons() {
        if (!this._hass) return [];
        return Object.values(this._hass.states)
            .filter((state) => state.entity_id.startsWith("person."))
            .map((state) => ({
                id: state.entity_id,
                name: state.attributes.friendly_name || state.entity_id.slice(7),
                userId: state.attributes.user_id,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    _personName(id) {
        if (!id || typeof id !== "string") return "";
        const state = this._hass?.states[id];
        return state?.attributes.friendly_name || id.replace(/^person\./, "");
    }

    // The logged-in user's person; kiosk users have none
    _myPerson() {
        const userId = this._hass?.user?.id;
        if (!userId) return null;
        return this._persons().find((p) => p.userId === userId)?.id || null;
    }

    // "Sam's turn", or "Both"/"Everyone" when escalated or anyone
    _turnLabel(activity) {
        const assigned = activity.assigned_to || [];
        if (!activity.assignees || !activity.assignees.length || !assigned.length) return "";
        if (assigned.length > 1) return assigned.length === 2 ? "Both" : "Everyone";
        return `${this._personName(assigned[0])}'s turn`;
    }

    // Shared tasks follow the card's person; everything else its category
    _isVisible(item) {
        const shared = Array.isArray(item.assignees) && item.assignees.length > 0;
        if (shared && this._config.person) {
            return (item.assigned_to || []).includes(this._config.person);
        }
        if ("category" in this._config)
            return (
                item["category"] == this._config["category"] ||
                item["category"] == "Activities"
            );
        return true;
    }

    _ifDue(activity, due, dueSoon) {
        if (activity.difference < 0) return due;
        if (activity.difference < this._config.soonHours * 60 * 60 * 1000)
            return dueSoon;
        return "";
    }

    render() {
        const result = html`
            <ha-card>
                ${this._renderHeader()}
                <div class="content">
                    <div class="am-grid">
                        ${repeat(
                            this._activities,
                            (activity) => activity.id,
                            (activity) => html`
                                <div
                                    @click=${() =>
                                        this._showUpdateDialog(activity)}
                                    class="am-item
                                    ${this._ifDue(
                                        activity,
                                        "am-due",
                                        "am-due-soon"
                                    )}
                                    ${activity.escalated ? "am-escalated" : ""}"
                                >
                                    <div class="am-icon">
                                        <ha-icon
                                            icon="${activity.icon
                                                ? activity.icon
                                                : "mdi:check-circle-outline"}"
                                        >
                                        </ha-icon>
                                    </div>
                                    <span class="am-item-name">
                                        <div class="am-item-primary">
                                            ${activity.names && activity.names.length > 0 ? 
                                              activity.names[activity.current_name_index || 0] : 
                                              activity.name}
                                        </div>
                                        <div class="am-item-secondary">
                                            ${utils._formatTimeAgo(activity.due)} - Last done: ${new Date(activity.last_completed).toLocaleDateString(undefined, {month: 'numeric', day: 'numeric'})}
                                            ${this._turnLabel(activity)
                                                ? html` · <span class="am-turn">${this._turnLabel(activity)}</span>`
                                                : ""}
                                        </div>
                                    </span>
                                    ${this._renderActionButton(activity)}
                                </div>
                            `
                        )}
                    </div>
                </div>
            </ha-card>
            ${this._renderFormDialog()} ${this._renderUpdateDialog()}
            ${this._renderRemoveDialog()}
        `;
        
        // Schedule styling after rendering
        setTimeout(() => this._applyCustomButtonStyling(), 0);
        
        return result;
    }

    _renderActionButton(activity) {
        return html`
            <div class="am-action">
                ${this._config.mode == "manage"
                    ? html`
                          <ha-icon-button
                              .path=${"M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"}
                              @click=${(ev) =>
                                  this._showRemoveDialog(ev, activity)}
                              data-am-id=${activity.id}
                          >
                          </ha-icon-button>
                      `
                    : ``}
            </div>
        `;
    }

    _renderHeader() {
        return html`
            <div class="header">
                <div class="icon-container">
                    <ha-icon icon="${this._config.icon}"></ha-icon>
                </div>
                <div class="info-container">
                    <div class="primary">${this._config.header}</div>
                </div>
                <div class="action-container">
                    <ha-icon-button
                        .path=${"M14.3 21.7C13.6 21.9 12.8 22 12 22C6.5 22 2 17.5 2 12S6.5 2 12 2C13.3 2 14.6 2.3 15.8 2.7L14.2 4.3C13.5 4.1 12.8 4 12 4C7.6 4 4 7.6 4 12S7.6 20 12 20C12.4 20 12.9 20 13.3 19.9C13.5 20.6 13.9 21.2 14.3 21.7M7.9 10.1L6.5 11.5L11 16L21 6L19.6 4.6L11 13.2L7.9 10.1M18 14V17H15V19H18V22H20V19H23V17H20V14H18Z"}
                        @click=${() => this._showAddDialog()}
                    >
                    </ha-icon-button>
                    <ha-icon-button
                        .path=${"M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z"}
                        @click=${this._switchMode}
                    >
                    </ha-icon-button>
                </div>
            </div>
        `;
    }

    // One form for Add and Edit; its values live in this._form
    _renderFormDialog() {
        const f = this._form;
        const title =
            f?.mode === "edit"
                ? "Edit task"
                : "Add task" + (this._config["category"] ? " for " + this._config["category"] : "");

        return html`
            <ha-dialog class="manage-form" .headerTitle=${title} @closed=${this._onDialogClosed}>
                ${f ? html`
                    <div class="confirm-grid form-grid">
                        ${this._renderNamesField(f)}

                        <div class="form-item">
                            <label for="am-form-category">Category</label>
                            <ha-textfield
                                id="am-form-category"
                                .value=${f.category}
                                @input=${(ev) => (f.category = ev.target.value)}
                            ></ha-textfield>
                        </div>

                        <div class="form-item">
                            <label>How often</label>
                            <div class="duration-input">
                                <ha-textfield type="number" inputmode="numeric" no-spinner label="days"
                                    .value=${String(f.days)} @input=${(ev) => (f.days = ev.target.value)}></ha-textfield>
                                <ha-textfield type="number" inputmode="numeric" no-spinner label="hours"
                                    .value=${String(f.hours)} @input=${(ev) => (f.hours = ev.target.value)}></ha-textfield>
                                <ha-textfield type="number" inputmode="numeric" no-spinner label="min"
                                    .value=${String(f.minutes)} @input=${(ev) => (f.minutes = ev.target.value)}></ha-textfield>
                            </div>
                        </div>

                        <div class="form-item">
                            <label for="am-form-icon">Icon</label>
                            <ha-icon-picker
                                id="am-form-icon"
                                .hass=${this._hass}
                                .value=${f.icon}
                                @value-changed=${(ev) => (f.icon = ev.detail.value || "")}
                            ></ha-icon-picker>
                        </div>

                        <div class="form-item">
                            <label for="am-form-last">${f.mode === "edit" ? "Last done (fix the date)" : "Last done"}</label>
                            <input
                                type="datetime-local"
                                id="am-form-last"
                                class="native-datetime"
                                .value=${f.lastCompleted}
                                @input=${(ev) => (f.lastCompleted = ev.target.value)}
                            />
                        </div>

                        ${this._features ? this._renderSharingFields(f) : ""}
                        ${this._features && f.mode === "edit" ? this._renderHistory() : ""}
                    </div>
                    <div class="dialog-actions form-dialog-actions">
                        ${f.mode === "edit" ? html`
                            <ha-button appearance="plain" variant="danger" @click=${this._deleteFromForm}>
                                Delete
                            </ha-button>
                        ` : ""}
                        <span class="actions-spacer"></span>
                        <ha-button appearance="filled" variant="neutral" @click=${() => this._closeDialog('.manage-form')}>
                            Cancel
                        </ha-button>
                        <ha-button appearance="filled" variant="brand" ?disabled=${f.saving} @click=${this._saveForm} class="add-button">
                            ${f.mode === "edit" ? "Save" : "Add"}
                        </ha-button>
                    </div>
                ` : ""}
            </ha-dialog>
        `;
    }

    // Each name is its own field, so renaming is just typing. Several names
    // are used one after another, one per completion.
    _renderNamesField(f) {
        const next = f.mode === "edit" && f.names.length > 1 ? f.names.indexOf(f.nextName) : -1;
        return html`
            <div class="form-field">
                <div class="field-label">
                    ${f.names.length > 1 ? "Names (used in order, one per completion)" : "Name"}
                </div>
                ${f.names.map((name, index) => html`
                    <div class="name-row">
                        <ha-textfield
                            .value=${name}
                            placeholder=${index === 0 ? "Task name" : "Another name"}
                            @input=${(ev) => (f.names[index] = ev.target.value)}
                        ></ha-textfield>
                        ${index === next ? html`<span class="name-next">next</span>` : ""}
                        <ha-icon-button
                            class="remove-name-button"
                            .path=${CLOSE_PATH}
                            ?disabled=${f.names.length <= 1}
                            @click=${() => this._formRemoveName(index)}
                        ></ha-icon-button>
                    </div>
                `)}
                <div>
                    <ha-button appearance="plain" variant="brand" @click=${this._formAddName}>
                        + Add another name
                    </ha-button>
                </div>
            </div>
        `;
    }

    _renderSharingFields(f) {
        const persons = this._persons();
        if (persons.length === 0) return "";
        const several = f.assignees.length > 1;
        const nextPerson = f.rotation === "fixed" ? f.turnOrder[0] : f.turnOrder[f.turnIndex];
        const chip = (selected, label, onClick) => html`
            <button type="button" class="am-chip ${selected ? "selected" : ""}" @click=${onClick}>${label}</button>
        `;

        return html`
            <div class="sharing-section">
                <div class="form-field">
                    <div class="field-label">Who does it</div>
                    <div class="chip-row">
                        ${persons.map((p) =>
                            chip(f.assignees.includes(p.id), p.name, () => this._formToggleAssignee(p.id))
                        )}
                    </div>
                    ${f.assignees.length === 0
                        ? html`<div class="field-hint">Nobody picked: it shows on the cards for its category.</div>`
                        : ""}
                </div>

                ${several ? html`
                    <div class="form-field">
                        <div class="field-label">How</div>
                        <div class="chip-row">
                            ${ROTATION_OPTIONS.map(([value, label]) =>
                                chip(f.rotation === value, label, () => this._formSet({ rotation: value }))
                            )}
                        </div>
                    </div>
                ` : ""}

                ${several && f.rotation !== "anyone" ? html`
                    <div class="form-field">
                        <div class="field-label">${f.rotation === "fixed" ? "Always done by" : "Next up"}</div>
                        <div class="chip-row">
                            ${[...new Set(f.turnOrder)].map((id) =>
                                chip(nextPerson === id, this._personName(id), () => this._formSetNext(id))
                            )}
                        </div>
                    </div>

                    <div class="form-field">
                        <div class="field-label">If not done, give it to everyone after</div>
                        <div class="escalate-row">
                            ${f.escUnit !== "never" ? html`
                                <ha-textfield
                                    type="number"
                                    inputmode="decimal"
                                    no-spinner
                                    .value=${String(f.escValue)}
                                    @input=${(ev) => (f.escValue = ev.target.value)}
                                ></ha-textfield>
                            ` : ""}
                            <div class="chip-row">
                                ${[["hours", "hours"], ["days", "days"], ["never", "Never"]].map(([unit, label]) =>
                                    chip(f.escUnit === unit, label, () => this._formSet({ escUnit: unit }))
                                )}
                            </div>
                        </div>
                    </div>
                ` : ""}

                ${several && f.rotation === "alternate" ? this._renderTurnPattern(f) : ""}
            </div>
        `;
    }

    // Advanced: the order turns go in, repeats allowed (Alex, Alex, Sam)
    _renderTurnPattern(f) {
        return html`
            <div class="form-field">
                <button type="button" class="advanced-toggle" @click=${() => this._formSet({ advanced: !f.advanced })}>
                    <ha-icon icon=${f.advanced ? "mdi:chevron-down" : "mdi:chevron-right"}></ha-icon>
                    Advanced: turn pattern
                </button>
                ${f.advanced ? html`
                    <div class="field-hint">Turns go in this order, then start over. Tap one to make it next.</div>
                    <div class="pattern-list">
                        ${f.turnOrder.map((id, index) => html`
                            <div class="pattern-item ${index === f.turnIndex ? "next" : ""}">
                                <button type="button" class="pattern-name" @click=${() => this._formSet({ turnIndex: index })}>
                                    ${index + 1}. ${this._personName(id)}${index === f.turnIndex ? " (next)" : ""}
                                </button>
                                <ha-icon-button
                                    class="remove-name-button"
                                    .path=${CLOSE_PATH}
                                    ?disabled=${f.turnOrder.length <= 1}
                                    @click=${() => this._formRemoveTurn(index)}
                                ></ha-icon-button>
                            </div>
                        `)}
                    </div>
                    <div class="chip-row">
                        ${f.assignees.map((id) => html`
                            <button type="button" class="am-chip" @click=${() => this._formSet({ turnOrder: [...f.turnOrder, id] })}>
                                + ${this._personName(id)}
                            </button>
                        `)}
                        <button type="button" class="am-chip" @click=${this._formResetTurns}>Reset</button>
                    </div>
                ` : ""}
            </div>
        `;
    }

    _renderHistory() {
        const f = this._form;
        const showName = (f.item?.names || []).length > 1;
        let body;
        if (this._historyLoading) {
            body = html`<div class="field-hint">Loading…</div>`;
        } else if (this._history.length === 0) {
            body = html`<div class="field-hint">Not done yet.</div>`;
        } else {
            body = html`
                <div class="history-list">
                    ${this._history.map((entry) => html`
                        <div class="history-row">
                            <div class="history-date">${this._formatWhen(entry.at)}</div>
                            <div class="history-who">
                                ${this._historyWho(entry)}
                                ${showName && entry.name ? html`<div class="history-name">${entry.name}</div>` : ""}
                            </div>
                        </div>
                    `)}
                </div>
            `;
        }
        return html`
            <div class="history-section">
                <div class="section-header">History</div>
                ${body}
            </div>
        `;
    }

    _historyWho(entry) {
        let who = entry.by
            ? this._personName(entry.by)
            : entry.source === "import" ? "Imported" : "Unknown";
        if (entry.by && entry.turn && entry.by !== entry.turn) {
            who += ` (for ${this._personName(entry.turn)})`;
        }
        if (entry.escalated) who += " · late";
        return who;
    }

    _formatWhen(iso) {
        const date = new Date(iso);
        if (isNaN(date.getTime())) return iso || "";
        return date.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });
    }

	_renderUpdateDialog() {
		const item = this._currentItem;

		return html`
			<ha-dialog class="confirm-update" .headerTitle=${"Yay, you did it!! 🎉"} @closed=${this._onDialogClosed}>
				<div class="confirm-grid">
					${item && this._features ? html`
						<div class="update-title-row">
							<div class="update-task-name">${item.name}</div>
							<ha-button appearance="outlined" variant="neutral" @click=${this._editCurrentItem}>
								Edit
							</ha-button>
						</div>
					` : ''}
					<div class="completed-date-field">
						<label for="update-last-completed">Date you completed it:</label>
						<input
							type="datetime-local"
							id="update-last-completed"
							.value=${this._doneAt}
							@input=${(ev) => (this._doneAt = ev.target.value)}
						/>
					</div>
					${item && this._features ? this._renderDoneBy(item) : ''}
					${item ? html`
						<div class="last-completed-info">
							Last completed: ${new Date(item.last_completed).toLocaleString()}${item.last_completed_by ? ` by ${this._personName(item.last_completed_by)}` : ''}
						</div>
						<div class="last-completed-info">
							Due date: ${new Date(new Date(item.last_completed).valueOf() + item.frequency_ms).toLocaleString()}
						</div>
						${this._turnLabel(item) ? html`
							<div class="last-completed-info">
								${(item.assigned_to || []).length > 1 ? "Assigned to: " : ""}${this._turnLabel(item)}${item.escalated ? " (overdue, so it went to everyone)" : ""}
							</div>
						` : ''}
					` : ''}
					
					${this._features ? '' : html`
					<div class="name-list-section">
						<div class="section-header-row">
							<div class="section-header">Task Names:</div>
							${this._currentItem && this._currentItem.names ?
								html`
									<div class="add-name-form">
										<ha-textfield
											type="text"
											id="add-new-name"
											placeholder="Add another name"
										></ha-textfield>
										<ha-button appearance="filled" variant="brand" @click=${this._addNameToActivity} class="inline-add-button">
											Add
										</ha-button>
									</div>
								` : ''
							}
						</div>
						${this._currentItem && this._currentItem.names ?
							html`
								<div class="name-chips">
									${this._currentItem.names.map((name, index) => html`
										<div class="name-chip ${index === (this._currentItem.current_name_index || 0) ? 'active' : ''}">
											${name}
											<ha-icon-button
												class="remove-name-button"
												.path=${"M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"}
												@click=${(e) => this._removeNameFromActivity(e, index)}
												?disabled=${this._currentItem.names.length <= 1}
											>
											</ha-icon-button>
										</div>
									`)}
								</div>
							` : ''
						}
					</div>
					`}
				</div>
				<div class="dialog-actions update-dialog-actions">
					<ha-button appearance="filled" variant="neutral" @click=${() => this._closeDialog('.confirm-update')}>
						Cancel
					</ha-button>
					<ha-button
						appearance="filled"
						variant="success"
						@click=${this._updateActivity}
						class="update-button"
					>
						Update
					</ha-button>
				</div>
			</ha-dialog>
		`;
	}

	// "Done by": the task's people (everyone if nobody is assigned), plus
	// the logged-in user's person so they can record covering for someone
	_doneByOptions(item) {
		const ids = item.assignees && item.assignees.length
			? [...item.assignees]
			: this._persons().map((p) => p.id);
		const mine = this._myPerson();
		if (mine && !ids.includes(mine)) ids.push(mine);
		return ids;
	}

	_renderDoneBy(item) {
		const options = this._doneByOptions(item);
		if (options.length === 0) return '';
		return html`
			<div class="form-field">
				<div class="field-label">Done by</div>
				<div class="chip-row">
					${options.map((id) => html`
						<button
							type="button"
							class="am-chip ${this._doneBy === id ? 'selected' : ''}"
							@click=${() => {
								this._doneBy = this._doneBy === id ? null : id;
								this.requestUpdate();
							}}
						>${this._personName(id)}</button>
					`)}
				</div>
			</div>
		`;
	}

    _renderRemoveDialog() {
        return html`
            <ha-dialog class="confirm-remove" .headerTitle=${"Confirm"} @closed=${this._onDialogClosed}>
                <div>
                    Remove
                    ${this._currentItem ? this._currentItem["name"] : ""}?
                </div>
                <div slot="footer" class="dialog-actions">
                    <ha-button appearance="filled" variant="neutral" @click=${() => this._closeDialog('.confirm-remove')}>
                        Cancel
                    </ha-button>
                    <ha-button
                        appearance="filled"
                        variant="danger"
                        @click=${this._removeActivity}
                        class="remove-button"
                    >
                        Remove
                    </ha-button>
                </div>
            </ha-dialog>
        `;
    }

    _closeDialog(dialogSelector) {
        const dialog = this.shadowRoot.querySelector(dialogSelector);
        if (dialog) {
            dialog.open = false;
            dialog.close?.();
        }
    }

    // Reset dialog state when it closes via any mechanism (scrim click,
    // Escape key, programmatic close). Without this, the open property
    // can desync after a scrim dismiss and subsequent show() calls no-op.
    _onDialogClosed(ev) {
        const dialog = ev.currentTarget;
        // Ignore "closed" bubbling up from a field inside the dialog
        if (dialog && ev.target === dialog) {
            dialog.open = false;
        }
    }

    // New method to show any dialog consistently
	_showDialog(dialogSelector, itemToSet = null) {
		// Set current item if provided
		if (itemToSet !== null) {
			this._currentItem = itemToSet;
		}

		// Force immediate update to ensure dialog exists
		this.requestUpdate();

		// Give the update a chance to render
		setTimeout(() => {
			try {
				const dialog = this.shadowRoot.querySelector(dialogSelector);

				if (!dialog) {
					console.error(`Dialog element not found: ${dialogSelector}`);
					return;
				}

				// Check if we're in a nested popup
				const inPopup = this.closest('.bubble-pop-up-container') || this.closest('ha-dialog');
				if (inPopup) {
					dialog.style.zIndex = '999999';
					dialog.style.position = 'fixed';
				}

				// Force-reset state before reopening. mwc-dialog's `open`
				// setter guards against same-value writes, so if the
				// previous dismiss didn't fully sync state (e.g. scrim
				// click), setting open=true again is a no-op. Toggle it
				// off first, then call show() on the next frame.
				if (dialog.open) {
					dialog.open = false;
					if (typeof dialog.close === 'function') {
						try { dialog.close(); } catch (_) { /* ignore */ }
					}
				}

				requestAnimationFrame(() => {
					if (typeof dialog.show === 'function') {
						dialog.show();
					} else {
						dialog.open = true;
					}

					this._adjustDialogSize(dialog);

					setTimeout(() => {
						const rect = dialog.getBoundingClientRect();
						if (rect.right > window.innerWidth) {
							dialog.style.left = `${window.innerWidth - rect.width - 20}px`;
						}
					}, 150);
				});

			} catch (error) {
				console.error(`Error showing dialog ${dialogSelector}:`, error);
			}
		}, 100);
	}

    // Method to show the Add dialog
    _showAddDialog() {
        this._openForm(null);
    }

    // Updated method to show update dialog
    _showUpdateDialog(item) {
        this._doneAt = utils._toLocalInput(new Date());
        // The logged-in user's person, else whoever's turn it is
        this._doneBy = this._myPerson() || item.turn || null;
        this._showDialog(".confirm-update", item);
    }

    // Updated method to show remove dialog
    _showRemoveDialog(ev, item) {
        ev?.stopPropagation();
        this._showDialog(".confirm-remove", item);
    }

    // Enhanced method to adjust dialog size
_adjustDialogSize(dialogElement) {
    if (!dialogElement) return;
    
    // Check if we're in a popup context
    const inPopup = this.closest('.bubble-pop-up-container') || this.closest('ha-dialog');
    const isMobile = window.innerWidth <= 600;
    const dialogWidth = isMobile ? "300px" : "400px";
    
    // Set explicit inline styles to force width overrides
    // dialogElement.style.setProperty('--mdc-dialog-min-width', dialogWidth, 'important');
    // dialogElement.style.setProperty('--mdc-dialog-max-width', dialogWidth, 'important');
    // dialogElement.style.width = dialogWidth;
    // dialogElement.style.maxWidth = dialogWidth;
    
    // Fix positioning for nested popups
    if (inPopup) {
        dialogElement.style.position = 'fixed';
        dialogElement.style.zIndex = '999999';
        
        // Center the dialog properly
        setTimeout(() => {
            const rect = dialogElement.getBoundingClientRect();
            const left = (window.innerWidth - rect.width) / 2;
            dialogElement.style.left = `${left}px`;
            dialogElement.style.right = 'auto';
            dialogElement.style.marginLeft = '0';
            dialogElement.style.transform = 'none';
        }, 100);
    }
    
    // Find and style the content container
    const contentElement = dialogElement.querySelector('.mdc-dialog__content');
    if (contentElement) {
        contentElement.style.width = dialogWidth;
        contentElement.style.maxWidth = dialogWidth;
        contentElement.style.overflow = 'visible';
    }
    
    setTimeout(() => {
        try {
            // Attempt to further enforce styles by updating shadow DOM elements
            if (dialogElement.shadowRoot) {
                const surface = dialogElement.shadowRoot.querySelector('.mdc-dialog__surface');
                if (surface) {
                    surface.style.setProperty('min-width', dialogWidth, 'important');
                    surface.style.setProperty('max-width', dialogWidth, 'important');
                    surface.style.width = dialogWidth;
                    surface.style.overflow = 'visible';
                }
                
                const container = dialogElement.shadowRoot.querySelector('.mdc-dialog__container');
                if (container) {
                    container.style.maxWidth = '100vw';
                    container.style.paddingLeft = '0';
                    container.style.paddingRight = '0';
                    
                    // Center the dialog
                    container.style.display = 'flex';
                    container.style.justifyContent = 'center';
                    container.style.alignItems = 'center';
                }
                
                // Fix scrim to cover entire viewport
                const scrim = dialogElement.shadowRoot.querySelector('.mdc-dialog__scrim');
                if (scrim && inPopup) {
                    scrim.style.position = 'fixed';
                    scrim.style.top = '0';
                    scrim.style.left = '0';
                    scrim.style.right = '0';
                    scrim.style.bottom = '0';
                }
            }
            
            // Button styling is handled by ha-button variant attributes
            
        } catch (error) {
            console.error("Error adjusting dialog size:", error);
        }
    }, 50);
}

    // Method to apply styling to all buttons
	_applyCustomButtonStyling() {
		setTimeout(() => {
			// Check screen size
			const isMobile = window.innerWidth <= 600;
			const dialogWidth = isMobile ? "300px" : "400px";
			
			const allDialogs = this.shadowRoot.querySelectorAll('ha-dialog');
			allDialogs.forEach(dialog => {
				// Set dialog width based on screen size
				// dialog.style.setProperty('--mdc-dialog-min-width', dialogWidth, 'important');
				// dialog.style.setProperty('--mdc-dialog-max-width', dialogWidth, 'important');
				// dialog.style.width = dialogWidth;
				// dialog.style.maxWidth = dialogWidth;
				
				// Button styling is handled by ha-button variant attributes
			});
		}, 100);
	}

    _switchMode(ev) {
        switch (this._config.mode) {
            case "basic":
                this._config.mode = "manage";
                break;
            case "manage":
                this._config.mode = "basic";
                break;
        }
        this.requestUpdate();
    }

    // --- Add/Edit form ---------------------------------------------------

    _openForm(item = null) {
        if (item) {
            const freq =
                item.frequency && typeof item.frequency === "object"
                    ? item.frequency
                    : { days: utils._getNumber(item.frequency, 0) };
            const assignees = [...(item.assignees || [])];
            this._form = {
                mode: "edit",
                item,
                names: [...(item.names && item.names.length ? item.names : [item.name])],
                nextName: (item.names || [])[item.current_name_index || 0],
                category: item.category || "",
                days: freq.days || 0,
                hours: freq.hours || 0,
                minutes: freq.minutes || 0,
                seconds: freq.seconds || 0,
                icon: item.icon || "",
                lastCompleted: utils._toLocalInput(new Date(item.last_completed)),
                assignees,
                rotation: item.rotation || "alternate",
                turnOrder: [...(item.turn_order && item.turn_order.length ? item.turn_order : assignees)],
                turnIndex: item.turn_index || 0,
                ...this._escalateFields(item.escalate_after, assignees.length > 1),
                advanced: false,
            };
            this._history = [];
            if (this._features) this._loadHistory(item.id);
        } else {
            // A card for one person adds tasks for that person
            const assignees = this._config.person ? [this._config.person] : [];
            this._form = {
                mode: "add",
                item: null,
                names: [""],
                nextName: null,
                category: this._config["category"] || "",
                days: 0,
                hours: 0,
                minutes: 0,
                seconds: 0,
                icon: "",
                lastCompleted: utils._toLocalInput(new Date()),
                assignees,
                rotation: "alternate",
                turnOrder: [...assignees],
                turnIndex: 0,
                escValue: 24,
                escUnit: "hours",
                advanced: false,
            };
        }
        // Starting values, so Save only sends what changed
        const { item: _item, ...start } = this._form;
        this._form.original = JSON.parse(JSON.stringify(start));
        this._showDialog(".manage-form");
    }

    // escalate_after from the integration -> number + unit for the form.
    // null means never for a shared task; otherwise default to 24 hours.
    _escalateFields(value, shared) {
        if (!value || typeof value !== "object") {
            return shared ? { escValue: 24, escUnit: "never" } : { escValue: 24, escUnit: "hours" };
        }
        const ms =
            (value.days || 0) * 86400000 +
            (value.hours || 0) * 3600000 +
            (value.minutes || 0) * 60000 +
            (value.seconds || 0) * 1000;
        if (ms > 0 && ms % 86400000 === 0) return { escValue: ms / 86400000, escUnit: "days" };
        return { escValue: Math.round((ms / 3600000) * 100) / 100, escUnit: "hours" };
    }

    _formEscalateAfter(f) {
        if (f.escUnit === "never") return null;
        const value = parseFloat(f.escValue);
        if (isNaN(value) || value < 0) return undefined;
        return { [f.escUnit]: value };
    }

    _formSet(values) {
        Object.assign(this._form, values);
        this.requestUpdate();
    }

    _formAddName() {
        this._form.names.push("");
        this.requestUpdate();
    }

    _formRemoveName(index) {
        const f = this._form;
        if (f.names.length <= 1) return;
        f.names.splice(index, 1);
        this.requestUpdate();
    }

    // Where `person` is in the pattern, keeping `prefer` if it still points
    // at them (the pattern can repeat people). Same rule as the integration.
    _turnIndexFor(order, person, prefer) {
        if (order[prefer] === person) return prefer;
        return Math.max(0, order.indexOf(person));
    }

    // Keep whoever is next up when people are added or removed
    _formToggleAssignee(id) {
        const f = this._form;
        const next = f.turnOrder[f.rotation === "fixed" ? 0 : f.turnIndex];
        if (f.assignees.includes(id)) {
            f.assignees = f.assignees.filter((p) => p !== id);
            f.turnOrder = f.turnOrder.filter((p) => p !== id);
        } else {
            f.assignees = [...f.assignees, id];
            f.turnOrder = [...f.turnOrder, id];
        }
        if (f.turnOrder.length === 0) f.turnOrder = [...f.assignees];
        f.turnIndex = this._turnIndexFor(f.turnOrder, next, f.turnIndex);
        this.requestUpdate();
    }

    _formSetNext(id) {
        const f = this._form;
        if (f.rotation === "fixed") {
            // "Always the same person" is the first one in the pattern
            const order = [...f.turnOrder];
            order.splice(order.indexOf(id), 1);
            f.turnOrder = [id, ...order];
            f.turnIndex = 0;
        } else {
            f.turnIndex = this._turnIndexFor(f.turnOrder, id, f.turnIndex);
        }
        this.requestUpdate();
    }

    _formRemoveTurn(index) {
        const f = this._form;
        if (f.turnOrder.length <= 1) return;
        f.turnOrder = f.turnOrder.filter((_, i) => i !== index);
        if (index < f.turnIndex) f.turnIndex--;
        f.turnIndex = f.turnIndex % f.turnOrder.length;
        this.requestUpdate();
    }

    _formResetTurns() {
        const f = this._form;
        const next = f.turnOrder[f.turnIndex];
        f.turnOrder = [...f.assignees];
        f.turnIndex = this._turnIndexFor(f.turnOrder, next, f.turnIndex);
        this.requestUpdate();
    }

    _loadHistory(itemId) {
        this._historyLoading = true;
        this.requestUpdate();
        this._hass
            .callWS({ type: "activity_manager/history", item_id: itemId, limit: 200 })
            .then((rows) => {
                if (this._form?.item?.id === itemId) this._history = rows || [];
            })
            .catch((error) => {
                console.error("Error loading history:", error);
                this._history = [];
            })
            .finally(() => {
                this._historyLoading = false;
                this.requestUpdate();
            });
    }

    _editCurrentItem() {
        const item = this._currentItem;
        if (!item) return;
        this._closeDialog('.confirm-update');
        this._openForm(item);
    }

    _deleteFromForm() {
        const item = this._form?.item;
        if (!item) return;
        this._closeDialog('.manage-form');
        this._showRemoveDialog(null, item);
    }

    async _saveForm() {
        const f = this._form;
        if (!f || f.saving) return;

        const names = f.names.map((n) => n.trim()).filter((n) => n.length > 0);
        if (names.length === 0) return this._showToast("Give the task a name.");
        const category = f.category.trim();
        if (!category) return this._showToast("Give the task a category.");
        const frequency = {
            days: Math.max(0, utils._getNumber(f.days, 0)),
            hours: Math.max(0, utils._getNumber(f.hours, 0)),
            minutes: Math.max(0, utils._getNumber(f.minutes, 0)),
            seconds: Math.max(0, utils._getNumber(f.seconds, 0)),
        };
        if (frequency.days + frequency.hours + frequency.minutes + frequency.seconds === 0)
            return this._showToast("Set how often it repeats.");
        const escalate = f.assignees.length ? this._formEscalateAfter(f) : null;
        if (escalate === undefined) return this._showToast("Check the 'give it to everyone' time.");

        let request;
        if (f.mode === "add" && !this._features) {
            // Older integration: the add_activity service, as before
            request = this._hass.callService("activity_manager", "add_activity", {
                name: names.length > 1 ? names : names[0],
                category,
                frequency,
                icon: f.icon || undefined,
                last_completed: f.lastCompleted || undefined,
            });
        } else if (f.mode === "add") {
            const payload = {
                type: "activity_manager/add",
                names,
                category,
                frequency,
                last_completed: utils._localToIso(f.lastCompleted) || undefined,
            };
            if (f.icon) payload.icon = f.icon;
            if (f.assignees.length) {
                Object.assign(payload, {
                    assignees: f.assignees,
                    rotation: f.rotation,
                    turn_order: f.turnOrder,
                    turn_index: f.turnIndex,
                    escalate_after: escalate,
                });
            }
            request = this._hass.callWS(payload);
        } else {
            const changes = this._formChanges(f, names, category, frequency, escalate);
            if (changes === null) return this._showToast("Check the last done date.");
            if (Object.keys(changes).length === 0) {
                this._closeDialog('.manage-form');
                return;
            }
            request = this._hass.callWS({
                type: "activity_manager/edit",
                item_id: f.item.id,
                ...changes,
            });
        }

        f.saving = true;
        this.requestUpdate();
        try {
            await request;
            this._closeDialog('.manage-form');
            this._fetchData();
        } catch (error) {
            console.error("Error saving activity:", error);
            this._showToast(`Couldn't save: ${error?.message || error}`);
        } finally {
            f.saving = false;
            this.requestUpdate();
        }
    }

    // Only the fields that changed, so an edit can't undo a completion
    // someone made while the form was open. null = bad date.
    _formChanges(f, names, category, frequency, escalate) {
        const o = f.original;
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const changes = {};

        if (!same(names, o.names)) changes.names = names;
        if (category !== o.category) changes.category = category;
        if (
            frequency.days !== utils._getNumber(o.days, 0) ||
            frequency.hours !== utils._getNumber(o.hours, 0) ||
            frequency.minutes !== utils._getNumber(o.minutes, 0)
        )
            changes.frequency = frequency;
        if (f.icon && f.icon !== o.icon) changes.icon = f.icon;
        if (f.lastCompleted !== o.lastCompleted) {
            // A correction, not a completion
            const iso = utils._localToIso(f.lastCompleted);
            if (!iso) return null;
            changes.last_completed = iso;
        }

        const assigneesChanged = !same(f.assignees, o.assignees);
        if (assigneesChanged) changes.assignees = f.assignees;
        if (f.assignees.length) {
            if (assigneesChanged || f.rotation !== o.rotation) changes.rotation = f.rotation;
            if (assigneesChanged || !same(f.turnOrder, o.turnOrder) || f.turnIndex !== o.turnIndex) {
                changes.turn_order = f.turnOrder;
                changes.turn_index = f.turnIndex;
            }
            if (assigneesChanged || f.escUnit !== o.escUnit || String(f.escValue) !== String(o.escValue))
                changes.escalate_after = escalate;
        }
        return changes;
    }

	_updateActivity() {
		if (this._currentItem == null) return;

		const itemId = this._currentItem["id"];
		const doneAt = this._doneAt;

		// Use the websocket API directly with the activity UUID — this avoids
		// the entity_id -> registry lookup in the service handler, which can
		// silently no-op if the registry lookup misses.
		const payload = {
			type: "activity_manager/update",
			item_id: itemId,
		};
		const iso = utils._localToIso(doneAt);
		if (iso) payload.last_completed = iso;
		// An older integration rejects fields it doesn't know
		if (this._features && this._doneBy) payload.completed_by = this._doneBy;

		this._hass.callWS(payload).then(() => {
			// Close dialog
			this._closeDialog('.confirm-update');

			// Update locally for immediate feedback
			const parsed = new Date(doneAt);
			this._currentItem.last_completed = isNaN(parsed.getTime())
				? new Date().toISOString()
				: parsed.toISOString();
			if (this._currentItem.names && this._currentItem.names.length > 1) {
				this._currentItem.current_name_index =
					(this._currentItem.current_name_index + 1) % this._currentItem.names.length;
			}

			// Refresh data
			this._fetchData();
		}).catch(error => {
			console.error("Error updating activity:", error);
			this._showToast("Error updating activity. Please try again.");
		});
	}

	_removeActivity() {
		if (this._currentItem == null) return;

		this._hass.callWS({
			type: "activity_manager/remove",
			item_id: this._currentItem["id"],
		}).then(() => {
			// Close the dialog immediately
			this._closeDialog('.confirm-remove');
			
			// Clear the current item
			this._currentItem = null;
			
			// The event subscription should handle the refresh
			// but we'll add a fallback just in case
			setTimeout(() => {
				if (this._activities.find(item => item.id === this._currentItem?.id)) {
					// If the item is still in the list after 500ms, force a refresh
					this._fetchData();
				}
			}, 500);
		}).catch(error => {
			console.error("Error removing activity:", error);
			this._showToast("Error removing activity. Please try again.");
		});
	}

_addNameToActivity() {
    if (this._currentItem == null) return;
    
    const newNameInput = this.shadowRoot.querySelector("#add-new-name");
    if (!newNameInput.value.trim()) return;
    
    // Find the actual entity_id for this activity
    this._getEntityIdForActivity(this._currentItem).then(entityId => {
        if (!entityId) {
            this._showToast("Could not find entity for this activity");
            return;
        }
        
        // Update the item locally
        if (!this._currentItem.names) {
            this._currentItem.names = [this._currentItem.name];
            this._currentItem.current_name_index = 0;
        }
        
        // Add the name locally for immediate UI update
        this._currentItem.names.push(newNameInput.value.trim());
        
        // Call the service to add the name
        this._hass.callService("activity_manager", "add_name", {
            entity_id: entityId,
            name: newNameInput.value.trim()
        }).then(() => {
            newNameInput.value = '';
            this.requestUpdate();
            this._showToast("Name added successfully!");
        }).catch(error => {
            console.error("Error adding name:", error);
            // Rollback local change
            this._currentItem.names.pop();
            this._showToast("Error adding name. Please try again.");
        });
    });
}

_removeNameFromActivity(event, index) {
    event.stopPropagation();
    
    if (this._currentItem == null) return;
    if (!this._currentItem.names || this._currentItem.names.length <= 1) {
        this._showToast("Cannot remove the last name!");
        return;
    }
    
    // Find the actual entity_id for this activity
    this._getEntityIdForActivity(this._currentItem).then(entityId => {
        if (!entityId) {
            this._showToast("Could not find entity for this activity");
            return;
        }
        
        // Store the name being removed for rollback
        const nameToRemove = this._currentItem.names[index];
        
        // Remove locally for immediate UI update
        this._currentItem.names.splice(index, 1);
        
        // Update current_name_index if needed
        if (index <= this._currentItem.current_name_index && this._currentItem.current_name_index > 0) {
            this._currentItem.current_name_index--;
        } else if (index == this._currentItem.current_name_index && index == this._currentItem.names.length) {
            this._currentItem.current_name_index = this._currentItem.names.length - 1;
        }
        
        // Call the service to remove the name
        this._hass.callService("activity_manager", "remove_name", {
            entity_id: entityId,
            index: index
        }).then(() => {
            this.requestUpdate();
            this._showToast("Name removed!");
        }).catch(error => {
            console.error("Error removing name:", error);
            // Rollback local change
            this._currentItem.names.splice(index, 0, nameToRemove);
            this._showToast("Error removing name. Please try again.");
        });
    });
}

// Helper method to find entity_id by activity id
async _getEntityIdForActivity(activity) {
    // Look through all entities to find the one with matching unique_id
    for (const [entityId, entity] of Object.entries(this._hass.states)) {
        if (entity.attributes && 
            entity.attributes.integration === "activity_manager" &&
            entity.attributes.id === activity.id) {
            return entityId;
        }
    }
    return null;
}

    _showToast(message) {
        // Simple feedback implementation
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.backgroundColor = 'rgba(0,0,0,0.7)';
        toast.style.color = 'white';
        toast.style.padding = '10px 20px';
        toast.style.borderRadius = '4px';
        toast.style.zIndex = '9999';
        
        document.body.appendChild(toast);
        
        // Remove after 3 seconds
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 3000);
    }

	_fetchData = async () => {
		this._probeFeatures();
		try {
			const items =
				(await this._hass?.callWS({
					type: "activity_manager/items",
				})) || [];

			// Process the items
			const processedActivities = items
				.map((item) => {
					const completed = new Date(item.last_completed);
					const due = new Date(completed.valueOf() + item.frequency_ms);
					const now = new Date();
					const difference = due - now; // milliseconds

					return {
						...item,
						// Handle both old and new data format
						name: item.names && item.names.length > 0 ? 
							item.names[item.current_name_index || 0] : 
							item.name,
						names: item.names || [item.name], // Ensure names array exists
						current_name_index: item.current_name_index || 0,
						due: due,
						difference: difference,
						time_unit: "day",
					};
				})
				.filter((item) => this._isVisible(item))
				.filter((item) => {
					if (this._config.showDueOnly) return item["difference"] < 0;
					return true;
				})
				.sort((a, b) => {
					// Sort by due date (soonest first)
					if (a.difference < 0 && b.difference >= 0) return -1;
					if (a.difference >= 0 && b.difference < 0) return 1;
					return a.difference - b.difference;
				});

			// Always update the activities and request an update
			this._activities = processedActivities;
			this.requestUpdate();
			
		} catch (error) {
			console.error("Error fetching activity data:", error);
			// On error, set empty array to clear the display
			this._activities = [];
			this.requestUpdate();
		}
	};

	static styles = css`
		:host {
        --am-item-primary-color: #ffffff;
        --am-item-background-color: #00000000;
        --am-item-due-primary-color: #ff4a4a;
        --am-item-due-background-color: #ff4a4a14;
        --am-item-due-soon-primary-color: #ffffff;
        --am-item-due-soon-background-color: #00000020;
        --am-item-primary-font-size: 14px;
        --am-item-secondary-font-size: 12px;
        --mdc-theme-primary: var(--primary-text-color);
        
        /* Define custom button colors */
        --am-primary-button-bg: var(--primary-color);
        --am-primary-button-text: white;
        --am-secondary-button-bg: var(--secondary-color, #808080);
        --am-secondary-button-text: white;
        
        /* Responsive dialog width variables */
        --dialog-desktop-width: 400px;
        --dialog-mobile-width: 300px;
        
        /* Fix for nested popups */
        display: block;
        width: 100%;
        box-sizing: border-box;
        overflow: visible !important;
    }
    
    /* Fix for bubble-card popup context */
    :host-context(.bubble-pop-up-container) {
        width: 100% !important;
        max-width: 100% !important;
    }
    
    :host-context(.bubble-pop-up-container) ha-card {
        overflow: visible !important;
    }
	
	/* Keep dialog action buttons large and comfortable */
	ha-dialog ha-button {
	  min-width: 60px !important;
	//   padding: 10px 16px !important;
	  font-size: 14px !important;
	}

	/* Dialog footer actions layout */
	.dialog-actions {
	  display: flex;
	  justify-content: flex-end;
	  gap: 12px;
	}
    
    /* Base dialog styling with fixes for nested popups */
    ha-dialog {
        --dialog-content-padding: 16px !important;
        position: fixed !important;
        z-index: 999999 !important;
    }
    
    /* Fix dialog positioning in nested contexts */
    :host-context(.bubble-pop-up-container) ha-dialog::part(dialog) {
        position: fixed !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        margin: 0 !important;
    }
    
    /* Ensure dialogs don't get cut off */
    .confirm-update,
    .confirm-remove,
    .manage-form {
			max-height: unset !important;   /* don’t force 90vh */
			height: auto !important;        /* shrink to content */
			overflow-y: visible !important; /* allow natural sizing */
    }
		
		/* Mobile styles (up to 600px) */
		@media (max-width: 600px) {
			ha-dialog {
				--dialog-width: var(--dialog-mobile-width) !important;
				--mdc-dialog-min-width: var(--dialog-mobile-width) !important;
				--mdc-dialog-max-width: var(--dialog-mobile-width) !important;
			}
			
			.confirm-update,
			.confirm-remove,
			.manage-form {
				width: var(--dialog-mobile-width) !important;
				max-width: var(--dialog-mobile-width) !important;
				--mdc-dialog-min-width: var(--dialog-mobile-width) !important;
				--mdc-dialog-max-width: var(--dialog-mobile-width) !important;
			}
			
			.duration-input {
				flex-wrap: nowrap;
				gap: 4px;
			}
			
			.duration-input ha-textfield {
				flex: 1;
				min-width: 50px;
				max-width: 65px;
			}
			
			.form-item {
				grid-template-columns: 1fr;
			}
			
			.name-chips {
				max-width: 100%;
				overflow-x: auto;
			}
			
			.last-completed-info {
				font-size: 12px;
				word-break: break-word;
			}
			
			.name-chip {
				font-size: 12px;
				padding: 3px 6px 3px 8px;
			}
			
			.remove-name-button {
				--mdc-icon-button-size: 20px;
				margin-left: 2px;
			}
		}
		
		/* Desktop styles (greater than 600px) */
		@media (min-width: 601px) {
			ha-dialog {
				--dialog-width: var(--dialog-desktop-width) !important;
				--mdc-dialog-min-width: var(--dialog-desktop-width) !important;
				--mdc-dialog-max-width: var(--dialog-desktop-width) !important;
			}
			
			.confirm-update,
			.confirm-remove,
			.manage-form {
				width: var(--dialog-desktop-width) !important;
				max-width: var(--dialog-desktop-width) !important;
				--mdc-dialog-min-width: var(--dialog-desktop-width) !important;
				--mdc-dialog-max-width: var(--dialog-desktop-width) !important;
			}
		}
		
		/* All other styles */
		.content {
			padding: 0 12px 12px 12px;
		}
		
		.am-add-form {
			padding-top: 10px;
			display: grid;
			align-items: center;
			gap: 24px;
		}
		
		.am-add-button {
			padding-top: 10px;
		}
		
		.duration-input {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 8px;
		}
		
		.duration-input ha-textfield {
			flex: 1;
			min-width: 60px;
			max-width: 80px;
		}
		
		.header {
			display: grid;
			grid-template-columns: 52px auto min-content;
			align-items: center;
			padding: 12px;
		}
		
		.icon-container {
			display: flex;
			height: 40px;
			width: 40px;
			border-radius: 50%;
			background: rgba(111, 111, 111, 0.2);
			place-content: center;
			align-items: center;
			margin-right: 12px;
		}
		
		.info-container {
			display: flex;
			flex-direction: column;
			justify-content: center;
		}
		
		.primary {
			font-weight: bold;
		}
		
		.action-container {
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
		}
		
		.am-grid {
			display: grid;
			gap: 12px;
		}

		.am-item {
			position: relative;
			display: inline-block;
			display: flex;
			#color: var(--am-item-primary-color, #ffffff);
			#background-color: var(--am-item-background-color, #000000ff);
			border-radius: 8px;
			align-items: center;
			padding: 12px;
			cursor: pointer;
		}

		.am-icon {
			display: block;
			border-radius: 50%;
			background-color: #333;
			padding: 5px;
			margin-right: 12px;
			--mdc-icon-size: 24px;
		}

		.am-item-name {
			flex: 1 1 auto;
		}

		.am-item-primary {
			font-size: var(--am-item-primary-font-size, 14px);
			font-weight: bold;
		}

		.am-item-secondary {
			font-size: var(--am-item-secondary-font-size, 12px);
		}

		.am-action {
			display: grid;
			grid-template-columns: auto auto;
			align-items: center;
		}

		.am-due-soon {
			color: var(--am-item-due-soon-primary-color, #ffffff);
			background-color: var(
				--am-item-due-soon-background-color,
				#00000020
			);
			--mdc-theme-primary: var(--am-item-due-soon-primary-color);
		}

		.am-due {
			color: var(--am-item-due-primary-color, #ffffff);
			background-color: var(--am-item-due-background-color, #00000014);
			--mdc-theme-primary: var(--am-item-due-primary-color);
		}

		.form-item {
			display: grid;
			grid-template-columns: 1fr 1.8fr;
			align-items: center;
			--mdc-shape-small: 0px;
		}

		.form-item input::-webkit-outer-spin-button,
		.form-item input::-webkit-inner-spin-button {
			-webkit-appearance: none;
		}

		.confirm-grid {
			display: grid;
			gap: 12px;
			max-width: 100%;
			overflow-y: auto;
			max-height: 60vh;
		}
		
		.last-completed-info {
			margin-top: 8px;
			font-size: 14px;
			color: var(--secondary-text-color);
		}

		.completed-date-field {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.completed-date-field label {
			font-size: 14px;
			color: var(--secondary-text-color);
		}

		.completed-date-field input[type="datetime-local"],
		input.native-datetime[type="datetime-local"] {
			width: 100%;
			box-sizing: border-box;
			padding: 10px 12px;
			font-size: 14px;
			font-family: inherit;
			color: var(--primary-text-color);
			background-color: var(--secondary-background-color, rgba(127, 127, 127, 0.1));
			border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.4));
			border-radius: 8px;
			/* Let the browser paint the calendar/clock picker icon for the
			   current theme so it stays visible in dark mode. */
			color-scheme: light dark;
		}

		.completed-date-field input[type="datetime-local"]:focus,
		input.native-datetime[type="datetime-local"]:focus {
			outline: none;
			border-color: var(--primary-color);
		}
		
		.name-list-section {
			margin-top: 16px;
			border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
			padding-top: 16px;
		}
		
		.section-header {
			font-weight: bold;
			margin-bottom: 8px;
		}

		.section-header-row {
			display: flex;
			align-items: center;
			gap: 12px;
			margin-bottom: 8px;
			flex-wrap: wrap;
		}

		.section-header-row .section-header {
			margin-bottom: 0;
			flex: 0 0 auto;
		}

		.section-header-row .add-name-form {
			flex: 1 1 160px;
			min-width: 0;
		}

		.section-header-row .add-name-form ha-textfield {
			flex: 1 1 auto;
			min-width: 0;
		}
		
		.name-chips {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-bottom: 12px;
			max-width: 100%;
			overflow-x: auto;
		}
			   
		.name-chip {
			display: flex;
			align-items: center;
			background-color: var(--secondary-background-color);
			border-radius: 16px;
			padding: 4px 8px 4px 12px;
			font-size: 14px;
		}
		
		.name-chip.active {
			background-color: var(--primary-color);
			color: var(--text-primary-color);
		}
		
		.add-name-form {
			display: flex;
			gap: 8px;
			align-items: center;
		}
		
		.remove-name-button {
			--mdc-icon-button-size: 24px;
			margin-left: 4px;
		}
		
		ha-textfield {
			width: 100% !important;
			--mdc-text-field-fill-color: transparent;
		}
		
		ha-textfield[type="datetime-local"] {
			font-size: 13px;
		}
		
		/* Catch-all to prevent content from expanding beyond dialog */
		ha-dialog * {
			max-width: 100%;
			box-sizing: border-box;
		}
		
		ha-dialog,
		.confirm-update,
		.confirm-remove,
		.manage-form {
		  width: auto !important;
		  max-width: 90vw !important;
		  --mdc-dialog-min-width: 280px !important;
		  --mdc-dialog-max-width: 400px !important;
		}

		@media (max-width: 600px) {
		  ha-dialog,
		  .confirm-update,
		  .confirm-remove,
		  .manage-form {
			max-width: 90vw !important;
			--mdc-dialog-min-height: auto !important;
			--mdc-dialog-max-height: 85vh !important;
			--mdc-dialog-min-width: 280px !important;
		  }

		  .confirm-update .confirm-grid {
			max-height: 65vh;
		  }

		}

		/* The update dialog's actions live as a sibling of the
		   scrollable confirm-grid so they always render below it as
		   their own section, separated by a divider. Cancel and
		   Update sit next to each other on the right, oversized
		   for easy mobile tapping. */
		.update-dialog-actions {
			display: flex;
			flex-direction: row;
			justify-content: flex-end;
			align-items: center;
			gap: 12px;
			margin-top: 16px;
			padding-top: 16px;
			border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
			height: 80px;
		}

		/* Make the action buttons large for easier tapping.
		   ha-button is webawesome-based — its inner control reads
		   --ha-button-height (which feeds --wa-form-control-height).
		   Setting height/min-height on the host alone leaves the
		   internal <button class="button"> stuck at the default 40px,
		   so we also override via ::part(base). */
		.update-dialog-actions ha-button {
			flex: 0 0 auto;
			width: 150px;
			--ha-button-height: 60px;
			font-size: 16px !important;
		}

		.update-dialog-actions ha-button::part(base) {
			height: 60px;
			min-height: 60px;
			font-size: 16px;
		}

		ha-dialog {
		  --mdc-dialog-min-height: auto !important;
		  --mdc-dialog-max-height: 80vh !important;
		}

		/* fallback: reset the actual MDC content */
		ha-dialog .mdc-dialog__content {
		  height: auto !important;
		  max-height: none !important;
		  flex: 0 0 auto !important;
		}


		
		.confirm-grid div,
		.last-completed-info,
		.name-chips {
			word-break: break-word;
			overflow-wrap: break-word;
		}

		/* Shared tasks: whose turn, and escalated (gone to everyone) */
		.am-turn {
			white-space: nowrap;
		}

		.am-escalated {
			box-shadow: inset 4px 0 0 var(--am-item-escalated-color, var(--warning-color, #ff9800));
		}

		.am-escalated .am-turn {
			font-weight: bold;
			color: var(--am-item-escalated-color, var(--warning-color, #ff9800));
		}

		/* Add/Edit form */
		.form-grid {
			gap: 16px;
			padding-top: 4px;
		}

		.form-field {
			display: grid;
			gap: 8px;
		}

		.field-label {
			font-size: 14px;
			color: var(--secondary-text-color);
		}

		.field-hint {
			font-size: 12px;
			color: var(--secondary-text-color);
		}

		.name-row {
			display: flex;
			align-items: center;
			gap: 4px;
		}

		.name-row ha-textfield {
			flex: 1 1 auto;
			min-width: 0;
		}

		.name-next {
			font-size: 12px;
			color: var(--primary-color);
		}

		/* Big tap targets for picking people and options */
		.chip-row {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}

		.am-chip {
			min-height: 40px;
			padding: 8px 14px;
			border-radius: 20px;
			border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.4));
			background: transparent;
			color: var(--primary-text-color);
			font: inherit;
			font-size: 14px;
			cursor: pointer;
		}

		.am-chip.selected {
			background: var(--primary-color);
			border-color: var(--primary-color);
			color: var(--text-primary-color, #ffffff);
		}

		.sharing-section,
		.history-section {
			display: grid;
			gap: 16px;
			border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
			padding-top: 16px;
		}

		.history-section {
			gap: 4px;
		}

		.escalate-row {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 8px;
		}

		.escalate-row ha-textfield {
			width: 90px !important;
			flex: 0 0 90px;
		}

		.advanced-toggle {
			display: flex;
			align-items: center;
			gap: 4px;
			min-height: 40px;
			padding: 0;
			background: none;
			border: none;
			color: var(--primary-color);
			font: inherit;
			font-size: 14px;
			cursor: pointer;
		}

		.pattern-list {
			display: grid;
			gap: 4px;
		}

		.pattern-item {
			display: flex;
			align-items: center;
			border-radius: 8px;
		}

		.pattern-item.next {
			background: var(--secondary-background-color);
		}

		.pattern-name {
			flex: 1 1 auto;
			min-height: 40px;
			text-align: left;
			background: none;
			border: none;
			color: var(--primary-text-color);
			font: inherit;
			font-size: 14px;
			cursor: pointer;
		}

		.history-list {
			max-height: 200px;
			overflow-y: auto;
		}

		.history-row {
			display: flex;
			justify-content: space-between;
			gap: 12px;
			padding: 8px 0;
			border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
			font-size: 14px;
		}

		.history-date {
			color: var(--secondary-text-color);
			white-space: nowrap;
		}

		.history-who {
			text-align: right;
		}

		.history-name {
			font-size: 12px;
			color: var(--secondary-text-color);
		}

		.form-dialog-actions {
			align-items: center;
			flex-wrap: wrap;
			gap: 8px;
			margin-top: 16px;
			padding-top: 16px;
			border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
		}

		.form-dialog-actions .actions-spacer {
			flex: 1 1 auto;
		}

		.form-dialog-actions ha-button {
			--ha-button-height: 48px;
		}

		/* Completion dialog: task name with the Edit button */
		.update-title-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
		}

		.update-task-name {
			font-size: 16px;
			font-weight: bold;
		}
	`;
}

class ActivityManagerCardEditor extends LitElement {
    _categories = [];

    static get properties() {
        return {
            hass: {},
            _config: {},
        };
    }

    setConfig(config) {
        this._config = config;
    }

	set hass(hass) {
		this._hass = hass;

		// Revert to original logic - populate categories directly
		Object.keys(this._hass["states"]).forEach((key) => {
			let entity = this._hass["states"][key];
			if ("attributes" in entity) {
				if ("integration" in entity.attributes) {
					if (entity.attributes.integration == "activity_manager") {
						if (
							!this._categories.some(
								(item) =>
									item.label === entity.attributes.category
							)
						) {
							this._categories.push({
								label: entity.attributes.category,
								value: entity.attributes.category,
							});
						}
					}
				}
			}
		});
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		if (this._unsubscribe) {
			this._unsubscribe();
			this._unsubscribe = null;
		}
	}
    _valueChanged(ev) {
        if (!this._config || !this._hass) {
            return;
        }
        const _config = Object.assign({}, this._config);
        _config.category = ev.detail.value.category;
        _config.soonHours = ev.detail.value.soonHours;
        _config.showDueOnly = ev.detail.value.showDueOnly;
        _config.icon = ev.detail.value.icon;
        // Shared tasks assigned to this person show on the card
        _config.person = ev.detail.value.person;
        if (!_config.person) delete _config.person;
        this._config = _config;

        const event = new CustomEvent("config-changed", {
            detail: { config: _config },
            bubbles: true,
            composed: true,
        });
        this.dispatchEvent(event);
    }

    render() {
        if (!this._hass || !this._config) {
            return html``;
        }
        return html`
            <ha-form
                .hass=${this._hass}
                .data=${this._config}
                .schema=${[
                    {
                        name: "category",
                        selector: {
                            select: {
                                options: this._categories,
                                custom_value: true,
                            },
                        },
                    },
                    {
                        name: "person",
                        selector: { entity: { filter: { domain: "person" } } },
                    },
                    { name: "icon", selector: { icon: {} } },
                    { name: "showDueOnly", selector: { boolean: {} } },
                    {
                        name: "soonHours",
                        selector: { number: { unit_of_measurement: "hours" } },
                    },
                ]}
                .computeLabel=${this._computeLabel}
                @value-changed=${this._valueChanged}
            ></ha-form>
        `;
    }

    _computeLabel(schema) {
        var labelMap = {
            category: "Category",
            person: "Person (shared tasks assigned to them show here)",
            icon: "Icon",
            showDueOnly: "Only show activities that are due",
            soonHours: "Soon to be due (styles the activity)",
            mode: "Manage mode",
        };
        return labelMap[schema.name];
    }
}

customElements.define("activity-manager-card", ActivityManagerCard);
customElements.define(
    "activity-manager-card-editor",
    ActivityManagerCardEditor
);

window.customCards = window.customCards || [];
window.customCards.push({
    type: "activity-manager-card",
    name: "Activity Manager Card",
    preview: true, // Optional - defaults to false
});

export const loadHaForm = async () => {
    if (
        customElements.get("ha-checkbox") &&
        customElements.get("ha-slider") &&
        customElements.get("ha-combo-box")
    )
        return;

    await customElements.whenDefined("partial-panel-resolver");
    const ppr = document.createElement("partial-panel-resolver");
    ppr.hass = {
        panels: [
            {
                url_path: "tmp",
                component_name: "config",
            },
        ],
    };
    ppr._updateRoutes();
    await ppr.routerOptions.routes.tmp.load();

    await customElements.whenDefined("ha-panel-config");
    const cpr = document.createElement("ha-panel-config");
    await cpr.routerOptions.routes.automation.load();
};