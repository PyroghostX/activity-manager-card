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
};

class ActivityManagerCard extends LitElement {
    _currentItem = null;
    _activities = [];
	_unsubscribe = null;

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
	}

    set hass(hass) {
        this._hass = hass;
        if (!this._runOnce) {
            // Update when loading
            this._fetchData();

            // Update when changes are made
            this._hass.connection.subscribeEvents(
                () => this._fetchData(),
                "activity_manager_updated"
            );

            this._runOnce = true;
        }
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
                                    )}"
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
                                        </div>
                                    </span>
                                    ${this._renderActionButton(activity)}
                                </div>
                            `
                        )}
                    </div>
                </div>
            </ha-card>
            ${this._renderAddDialog()} ${this._renderUpdateDialog()}
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
                          <mwc-icon-button
                              @click=${(ev) =>
                                  this._showRemoveDialog(ev, activity)}
                              data-am-id=${activity.id}
                          >
                              <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                              >
                                  <path
                                      d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"
                                  />
                              </svg>
                          </mwc-icon-button>
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
                    <mwc-icon-button
                        @click=${() => this._showAddDialog()}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                        >
                            <path
                                d="M14.3 21.7C13.6 21.9 12.8 22 12 22C6.5 22 2 17.5 2 12S6.5 2 12 2C13.3 2 14.6 2.3 15.8 2.7L14.2 4.3C13.5 4.1 12.8 4 12 4C7.6 4 4 7.6 4 12S7.6 20 12 20C12.4 20 12.9 20 13.3 19.9C13.5 20.6 13.9 21.2 14.3 21.7M7.9 10.1L6.5 11.5L11 16L21 6L19.6 4.6L11 13.2L7.9 10.1M18 14V17H15V19H18V22H20V19H23V17H20V14H18Z"
                            />
                        </svg>
                    </mwc-icon-button>
                    <mwc-icon-button @click=${this._switchMode}>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                        >
                            <path
                                d="M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z"
                            />
                        </svg>
                    </mwc-icon-button>
                </div>
            </div>
        `;
    }

    _renderAddDialog() {
        const date = new Date();
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const day = date.getDate().toString().padStart(2, "0");
        const hours = date.getHours().toString().padStart(2, "0");
        const minutes = date.getMinutes().toString().padStart(2, "0");
        let val = `${year}-${month}-${day}T${hours}:${minutes}`;

        return html`
            <ha-dialog class="manage-form" heading="Add Activity for ${this._config["category"]}">
                <form>
                    <div class="am-add-form" >
                        <input
                            type="hidden"
                            id="category"
                            placeholder="Category"
                            value="${this._config["category"]}" />

                        <div class="form-item">
                            <ha-textfield type="text" id="name" placeholder="Names (separate with commas)" style="grid-column: 1 / span 2">
                            </ha-textfield>
                        </div>
                        
                        <div class="form-item">
                            <label for="frequency-day">Frequency</label>
                            <div class="duration-input">
                                <ha-textfield type="number" inputmode="numeric" no-spinner label="dd" id="frequency-day" value="0"></ha-textfield>
                                <ha-textfield type="number" inputmode="numeric" no-spinner label="hh" id="frequency-hour" value="0"></ha-textfield>
                                <ha-textfield type="number" inputmode="numeric" no-spinner label="mm" id="frequency-minute" value="0"></ha-textfield>
                                <ha-textfield type="number" inputmode="numeric" no-spinner label="ss"id="frequency-second" value="0"></ha-textfield>
                            </div>
                        </div>

                        <div class="form-item">
                            <label for="icon">Icon</label>
                            <ha-icon-picker type="text" id="icon">
                            </ha-icon-picker>
                        </div>

                        <div class="form-item">
                            <label for="last-completed">Last Completed</label>
                            <ha-textfield type="datetime-local" id="last-completed" value=${val}>
                            </ha-textfield>
                        </div>
                    </div>
                    </ha-form>
                </form>
                <mwc-button 
                    slot="primaryAction" 
                    dialogAction="discard" 
                    @click=${this._addActivity}
                    class="add-button"
                >
                    Add
                </mwc-button>
                <mwc-button slot="secondaryAction" dialogAction="cancel">
                    Cancel
                </mwc-button>
            </ha-dialog>
        `;
    }

	_renderUpdateDialog() {
		const date = new Date();
		const year = date.getFullYear();
		const month = (date.getMonth() + 1).toString().padStart(2, "0");
		const day = date.getDate().toString().padStart(2, "0");
		const hours = date.getHours().toString().padStart(2, "0");
		const minutes = date.getMinutes().toString().padStart(2, "0");
		let val = `${year}-${month}-${day}T${hours}:${minutes}`;

		return html`
			<ha-dialog class="confirm-update" heading="Yay, you did it! 🎉">
				<div class="confirm-grid">
					<ha-textfield
						type="datetime-local"
						id="update-last-completed"
						label="Date you completed it:"
						value=${val}
					>
					</ha-textfield>
					${this._currentItem ? html`
						<div class="last-completed-info">
							Last completed: ${new Date(this._currentItem.last_completed).toLocaleString()}
						</div>
						<div class="last-completed-info">
							Due date: ${new Date(new Date(this._currentItem.last_completed).valueOf() + this._currentItem.frequency_ms).toLocaleString()}
						</div>
					` : ''}
					
					<div class="name-list-section">
						<div class="section-header">Task Names:</div>
						${this._currentItem && this._currentItem.names ? 
							html`
								<div class="name-chips">
									${this._currentItem.names.map((name, index) => html`
										<div class="name-chip ${index === (this._currentItem.current_name_index || 0) ? 'active' : ''}">
											${name}
											<mwc-icon-button 
												class="remove-name-button"
												@click=${(e) => this._removeNameFromActivity(e, index)}
												?disabled=${this._currentItem.names.length <= 1}
											>
												<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
													<path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
												</svg>
											</mwc-icon-button>
										</div>
									`)}
								</div>
								<div class="add-name-form">
									<ha-textfield
										type="text"
										id="add-new-name"
										placeholder="Add another name"
									></ha-textfield>
									<mwc-button @click=${this._addNameToActivity} class="inline-add-button">
										Add
									</mwc-button>
								</div>
							` : ''
						}
					</div>
				</div>
				<mwc-button
					slot="primaryAction"
					dialogAction="discard"
					@click=${this._updateActivity}
					class="update-button"
				>
					Update
				</mwc-button>
				<mwc-button slot="secondaryAction" dialogAction="cancel">
					Cancel
				</mwc-button>
			</ha-dialog>
		`;
	}

    _renderRemoveDialog() {
        return html`
            <ha-dialog class="confirm-remove" heading="Confirm">
                <div>
                    Remove
                    ${this._currentItem ? this._currentItem["name"] : ""}?
                </div>
                <mwc-button
                    slot="primaryAction"
                    dialogAction="discard"
                    @click=${this._removeActivity}
                    class="remove-button"
                >
                    Remove
                </mwc-button>
                <mwc-button slot="secondaryAction" dialogAction="cancel">
                    Cancel
                </mwc-button>
            </ha-dialog>
        `;
    }

    // New method to show any dialog consistently
	_showDialog(dialogSelector, itemToSet = null) {
		console.log(`Showing dialog: ${dialogSelector}`);
		
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
				console.log("Dialog element:", dialog);
				
				if (!dialog) {
					console.error(`Dialog element not found: ${dialogSelector}`);
					return;
				}
				
				// Check if we're in a nested popup
				const inPopup = this.closest('.bubble-pop-up-container') || this.closest('ha-dialog');
				if (inPopup) {
					// For nested popups, ensure proper z-index stacking
					dialog.style.zIndex = '999999';
					dialog.style.position = 'fixed';
				}
				
				// Check if show method exists
				if (typeof dialog.show !== 'function') {
					console.error("Dialog doesn't have show method, trying open");
					if (typeof dialog.open === 'function') {
						dialog.open();
					} else {
						// Fallback - set attribute directly
						dialog.setAttribute('open', 'true');
					}
				} else {
					dialog.show();
				}
				
				// Apply sizing after showing
				this._adjustDialogSize(dialog);
				
				// Ensure dialog is visible in viewport
				setTimeout(() => {
					const rect = dialog.getBoundingClientRect();
					if (rect.right > window.innerWidth) {
						dialog.style.left = `${window.innerWidth - rect.width - 20}px`;
					}
				}, 150);
				
			} catch (error) {
				console.error(`Error showing dialog ${dialogSelector}:`, error);
			}
		}, 100);
	}

    // Method to show the Add dialog
    _showAddDialog() {
        this._showDialog(".manage-form");
    }

    // Updated method to show update dialog
    _showUpdateDialog(item) {
        this._showDialog(".confirm-update", item);
    }

    // Updated method to show remove dialog
    _showRemoveDialog(ev, item) {
        ev.stopPropagation();
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
    dialogElement.style.setProperty('--mdc-dialog-min-width', dialogWidth, 'important');
    dialogElement.style.setProperty('--mdc-dialog-max-width', dialogWidth, 'important');
    dialogElement.style.width = dialogWidth;
    dialogElement.style.maxWidth = dialogWidth;
    
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
            
            // Style buttons
            const buttons = dialogElement.querySelectorAll('mwc-button');
            buttons.forEach(button => {
                button.setAttribute('raised', '');
                
                // Style based on button class
                if (button.classList.contains('inline-add-button')) {
                    button.style.setProperty('color', 'white', 'important');
                    button.style.setProperty('background-color', 'var(--primary-color)', 'important');
                } else {
                    // Style based on slot
                    const slot = button.getAttribute('slot');
                    if (slot === 'primaryAction') {
                        button.style.setProperty('color', 'white', 'important');
                        button.style.setProperty('background-color', 'var(--primary-color)', 'important');
                    } else if (slot === 'secondaryAction') {
                        button.style.setProperty('color', 'white', 'important');
                        button.style.setProperty('background-color', 'var(--secondary-color, #808080)', 'important');
                    }
                }
                
                button.style.borderRadius = '18px';
            });
            
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
				dialog.style.setProperty('--mdc-dialog-min-width', dialogWidth, 'important');
				dialog.style.setProperty('--mdc-dialog-max-width', dialogWidth, 'important');
				dialog.style.width = dialogWidth;
				dialog.style.maxWidth = dialogWidth;
				
				// Style buttons
				const buttons = dialog.querySelectorAll('mwc-button');
				buttons.forEach(button => {
					button.setAttribute('raised', '');
					
					// Style based on button class and slot
					if (button.classList.contains('inline-add-button')) {
						button.style.setProperty('color', 'white', 'important');
						button.style.setProperty('background-color', 'var(--primary-color)', 'important');
					} else if (button.classList.contains('add-button')) {
						button.style.setProperty('color', 'white', 'important');
						button.style.setProperty('background-color', 'var(--info-color, #4a90e2)', 'important');
					} else if (button.classList.contains('update-button')) {
						button.style.setProperty('color', 'white', 'important');
						button.style.setProperty('background-color', 'var(--primary-color)', 'important');
					} else if (button.classList.contains('remove-button')) {
						button.style.setProperty('color', 'white', 'important');
						button.style.setProperty('background-color', 'var(--error-color, #ff5252)', 'important');
					} else {
						// Default styling based on slot
						const slot = button.getAttribute('slot');
						if (slot === 'primaryAction') {
							button.style.setProperty('color', 'white', 'important');
							button.style.setProperty('background-color', 'var(--primary-color)', 'important');
						} else if (slot === 'secondaryAction') {
							button.style.setProperty('color', 'white', 'important');
							button.style.setProperty('background-color', 'var(--secondary-color, #808080)', 'important');
						}
					}
					
					button.style.borderRadius = '18px';
				});
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

    _addActivity() {
        let nameField = this.shadowRoot.querySelector("#name");
        if (!nameField) {
            console.error("Name field not found");
            return;
        }
        
        let category = this.shadowRoot.querySelector("#category");
        if (!category) {
            console.error("Category field not found");
            return;
        }
        
        let icon = this.shadowRoot.querySelector("#icon");
        let last_completed = this.shadowRoot.querySelector("#last-completed");

        // Handle frequency inputs with null checks
        let frequencyDay = this.shadowRoot.querySelector("#frequency-day");
        let frequencyHour = this.shadowRoot.querySelector("#frequency-hour");
        let frequencyMinute = this.shadowRoot.querySelector("#frequency-minute");
        let frequencySecond = this.shadowRoot.querySelector("#frequency-second");
        
        let frequency = {};
        frequency.days = utils._getNumber(
            frequencyDay ? frequencyDay.value : "0",
            0
        );
        frequency.hours = utils._getNumber(
            frequencyHour ? frequencyHour.value : "0",
            0
        );
        frequency.minutes = utils._getNumber(
            frequencyMinute ? frequencyMinute.value : "0",
            0
        );
        frequency.seconds = utils._getNumber(
            frequencySecond ? frequencySecond.value : "0",
            0
        );

        // Parse comma-separated names if there are commas
        let nameValue = nameField.value;
        if (nameValue.includes(',')) {
            nameValue = nameValue.split(',').map(n => n.trim()).filter(n => n.length > 0);
        }

        // Service call with proper error handling
        try {
            this._hass.callService("activity_manager", "add_activity", {
                name: nameValue,
                category: category.value,
                frequency: frequency,
                icon: icon ? icon.value : undefined,
                last_completed: last_completed ? last_completed.value : undefined,
            });
            
            // Clear fields
            nameField.value = "";
            if (icon) icon.value = "";

            // Close dialog
            let manageEl = this.shadowRoot.querySelector(".manage-form");
            if (manageEl) manageEl.close();
        } catch (error) {
            console.error("Error adding activity:", error);
        }
    }

	_updateActivity() {
		if (this._currentItem == null) return;

		let last_completed = this.shadowRoot.querySelector("#update-last-completed");

		// Find the actual entity_id
		this._getEntityIdForActivity(this._currentItem).then(entityId => {
			if (!entityId) {
				this._showToast("Could not find entity for this activity");
				return;
			}
			
			this._hass.callService("activity_manager", "update_activity", {
				entity_id: entityId,
				last_completed: last_completed.value
			}).then(() => {
				// Close dialog
				const dialog = this.shadowRoot.querySelector(".confirm-update");
				if (dialog) dialog.close();
				
				// Update locally for immediate feedback
				this._currentItem.last_completed = new Date(last_completed.value).toISOString();
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
		});
	}

	_removeActivity() {
		if (this._currentItem == null) return;

		this._hass.callWS({
			type: "activity_manager/remove",
			item_id: this._currentItem["id"],
		}).then(() => {
			// Close the dialog immediately
			const dialog = this.shadowRoot.querySelector(".confirm-remove");
			if (dialog) dialog.close();
			
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
				.filter((item) => {
					if ("category" in this._config)
						return (
							item["category"] == this._config["category"] ||
							item["category"] == "Activities"
						);
					return true;
				})
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
	ha-dialog mwc-button {
	  min-width: 60px !important;
	  padding: 10px 16px !important;
	  font-size: 14px !important;
	  --mdc-button-height: 40px !important;
	}

	/* Space between buttons */
	ha-dialog mwc-button + mwc-button {
	  margin-left: 12px !important;
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
        max-height: 90vh !important;
        overflow-y: auto !important;
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
		
		/* Style for the inline Add button */
		.inline-add-button {
			background-color: var(--secondary-color) !important;
			color: white !important;
			border-radius: 18px !important;
			--mdc-theme-primary: var(--secondary-color) !important;
			--mdc-button-raised: true !important;
		}
		
		/* Button styling - specific colors for different buttons */
		mwc-button[slot="primaryAction"] {
			background-color: var(--primary-color) !important;
			color: white !important;
			border-radius: 18px !important;
			--mdc-theme-primary: var(--primary-color) !important;
		}
		
		mwc-button[slot="secondaryAction"] {
			background-color: var(--secondary-color, #808080) !important;
			color: white !important;
			border-radius: 18px !important;
			--mdc-theme-primary: var(--secondary-color, #808080) !important;
		}
		
		/* Special button styles */
		.add-button {
			background-color: var(--info-color, #4a90e2) !important;
			color: white !important;
		}
		
		.update-button {
			background-color: var(--primary-color) !important;
			color: white !important;
		}
		
		.remove-button {
			background-color: var(--error-color, #ff5252) !important;
			color: white !important;
		}
		
		/* Force buttons to show raised style */
		mwc-button {
			--mdc-button-raised: true !important;
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
		
		.name-list-section {
			margin-top: 16px;
			border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
			padding-top: 16px;
		}
		
		.section-header {
			font-weight: bold;
			margin-bottom: 8px;
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
		
		.confirm-grid div,
		.last-completed-info,
		.name-chips {
			word-break: break-word;
			overflow-wrap: break-word;
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
		
		if (!this._runOnce) {
			// Update when loading
			this._fetchData();

			// Ensure we have a connection before subscribing
			if (this._hass.connection) {
				// Unsubscribe from any existing subscription
				if (this._unsubscribe) {
					this._unsubscribe();
				}
				
				// Subscribe to updates
				this._unsubscribe = this._hass.connection.subscribeEvents(
					(event) => {
						console.log("Activity manager event received:", event);
						this._fetchData();
					},
					"activity_manager_updated"
				);
			}

			this._runOnce = true;
		}
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
