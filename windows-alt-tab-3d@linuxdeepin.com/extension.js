const Lang = imports.lang;
const Main = imports.ui.main;

const Gettext = imports.gettext;
const Gtk = imports.gi.Gtk;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const AltTab = imports.ui.altTab;
const Tweener = imports.ui.tweener;

let SWITCH_ACTOR_SCALE = 0.5;
let SWITCH_ACTOR_SIDE_SCALE = 0.5;
let switcher = null;
let monitor = null;
let _;

function getTypeString(object) {
    try {
        return object.toString().split(' ')[1].split(']')[0];
    } catch (x) {
        return '';
    }
}

function getWorkspaceClone(workspaceIndex, targetWidth, targetHeight, scale) {
    // Get monitor size and scale value.
    let width = monitor.width;
    let height = monitor.height;

    // Create actor group.
    let workspaceClone = new Clutter.Group({clip_to_allocation: true});
    workspaceClone.set_size(targetWidth, targetHeight);

    // Add background.
    let background = Meta.BackgroundActor.new_for_screen(global.screen);
    background.set_scale(scale, scale);
    workspaceClone.add_actor(background);

    // Add panel.
    let [panelWidth, panelHeight] = Main.panel.actor.get_size();
    let panel = new Clutter.Clone(
        {source: Main.panel.actor,
         x: 0,
         y: 0,
         width: panelWidth * scale,
         height: panelHeight * scale
        }
    );
    workspaceClone.add_actor(panel);

    // Scale workspace windows.
    let apps = Shell.AppSystem.get_default().get_running();
    let workspaceWindows = [];
    for (let i in apps) {
        let windows = apps[i].get_windows();
        for (let j in windows) {
            if (windows[j].get_workspace().index() == workspaceIndex) {
                workspaceWindows.push(windows[j]);
            }
        }
    }

    // Sort workspace windows.
    workspaceWindows.sort(sortWindow);

    // Add workspace windows.
    let windowsCoordinates = {};
    for (let ii in workspaceWindows) {
        let windowTexture = workspaceWindows[ii].get_compositor_private().get_texture();
        let rect = workspaceWindows[ii].get_outer_rect();
        let windowClone = new Clutter.Clone(
            {source: windowTexture,
             x: rect.x * scale,
             y: rect.y * scale,
             width: rect.width * scale,
             height: rect.height * scale
            });

        windowsCoordinates[windowClone.toString()] = [rect.x * scale, rect.y * scale];
        workspaceClone.add_actor(windowClone);
    }

    return [workspaceClone, windowsCoordinates];
}

function getWindowClone(app, window, targetWidth, targetHeight, scale) {
    let compositor = window.get_compositor_private();
    let texture = compositor.get_texture();
    let [windowWidth, windowHeight] = texture.get_size();

    let windowClone = new Clutter.Group({clip_to_allocation: true});
    windowClone.set_size(targetWidth, targetHeight);

    // Add window clone.
    let clone = new Clutter.Clone(
        {opacity: 255,
         source: texture,
         x: 0,
         y: 0,
         width: targetWidth,
         height: targetHeight
        });
    windowClone.add_actor(clone);

    // Add application icon.
    let appIconSize = 48;
    let appIconBoxSize = 56;
    let appIcon = app.create_icon_texture(appIconSize);
    let appIconBox = new St.Bin( { style_class: 'alt-tab-app-icon-box'});
    let appIconCoordindate = {};
	let appIconX = windowWidth * scale - appIconBoxSize;
	let appIconY = windowHeight * scale - appIconBoxSize;
	
    appIconCoordindate[appIconBox.toString()] = [appIconX, appIconY];
    appIcon.set_position(appIconX, appIconY);
	appIconBox.add_actor(appIcon);
    windowClone.add_actor(appIconBox);

    return [windowClone, appIconCoordindate];
}

function sortWindow(window1, window2) {
    let t1 = window1.get_user_time();
    let t2 = window2.get_user_time();
    if (t2 < t1) {
        return 1;
    } else {
        return -1;
    }
}

function SwitchActor(app, window) {
    this._init(app, window);
}

SwitchActor.prototype = {
    _init : function(app, window) {
        this.app = app;
        this.window = window;
        let activeWorkspace = global.screen.get_active_workspace();
        this.isWorkspace = !(window.get_workspace() == activeWorkspace);

        this.initActorSize();
        this.initActorClone();
    },

    moveToCenter: function() {
        this.clone.raise_top();
        this.clone.rotation_center_y = new Clutter.Vertex(
            {x: this.target_width / 2,// coordinate is relative to clone self
             y: 0.0,
             z: 0.0 });
        Tweener.addTween(
            this.clone,
            {opacity: 255,
             x: (monitor.width - this.target_width) / 2,
             y: (monitor.height - this.target_height) / 2,
             width: this.target_width,
             height: this.target_height,
             rotation_angle_y: 0.0,
             time: 0.25,
             transition: 'easeOutQuad'
            });
        try {
            if (this.isWorkspace) {
                this.clone.get_children().forEach(
                    Lang.bind(this, function(clone) {
                                  if (getTypeString(clone) != "MetaBackgroundActor") {
                                      if (this.cloneCoordinates[clone.toString()]) {
                                          let [x, y] = this.cloneCoordinates[clone.toString()];
                                          clone.set_position(x, y);
                                      }
                                      clone.set_scale(1, 1);
                                  } else {
                                      clone.set_scale(this.scale, this.scale);
                                  }
                              }));
            } else {
                this.clone.get_children().forEach(
                    Lang.bind(this, function(clone) {
                                  if (this.cloneCoordinates[clone.toString()]) {
                                      let [x, y] = this.cloneCoordinates[clone.toString()];
                                      clone.set_position(x, y);
                                  }
                                  clone.set_scale(1, 1);
                              }));
            }
        } catch (x) {
            global.log(x);
            throw x;
        }
    },

    moveToLeft: function(indexOffset) {
        this.clone.raise_top();
        global.log(this.target_width_side);
        this.clone.rotation_center_y = new Clutter.Vertex(
            {x: this.target_width_side / 2, // coordinate is relative to clone self
             y: 0.0,
             z: 0.0 });
        Tweener.addTween(
            this.clone,
            {opacity: 255,
             x: monitor.width * 0.2 - (this.target_width_side) / 2,
             y: (monitor.height - this.target_height_side) / 2,
             width: this.target_width_side,
             height: this.target_height_side,
             rotation_angle_y: 60.0,
             time: 0.25,
             transition: 'easeOutQuad'
            });
        try {
            if (this.isWorkspace) {
                this.clone.get_children().forEach(
                    Lang.bind(this, function(clone) {
                                  if (getTypeString(clone) != "MetaBackgroundActor") {
                                      if (this.cloneCoordinates[clone.toString()]) {
                                          let [x, y] = this.cloneCoordinates[clone.toString()];
                                          clone.set_position(x * SWITCH_ACTOR_SIDE_SCALE, y * SWITCH_ACTOR_SIDE_SCALE);
                                      }
                                      clone.set_scale(SWITCH_ACTOR_SIDE_SCALE, SWITCH_ACTOR_SIDE_SCALE);
                                  } else {
                                      clone.set_scale(this.scale * SWITCH_ACTOR_SIDE_SCALE, this.scale * SWITCH_ACTOR_SIDE_SCALE);
                                  }
                              }));
            } else {
                this.clone.get_children().forEach(
                    Lang.bind(this, function(clone) {
                                  if (this.cloneCoordinates[clone.toString()]) {
                                      let [x, y] = this.cloneCoordinates[clone.toString()];
                                      clone.set_position(x * SWITCH_ACTOR_SIDE_SCALE, y * SWITCH_ACTOR_SIDE_SCALE);
                                  }
                                  clone.set_scale(SWITCH_ACTOR_SIDE_SCALE, SWITCH_ACTOR_SIDE_SCALE);
                              }));
            }
        } catch (x) {
            global.log(x);
            throw x;
        }
    },

    moveToRight: function(indexOffset) {
        this.clone.lower_bottom();
        this.clone.rotation_center_y = new Clutter.Vertex(
            {x: this.target_width_side / 2,// coordinate is relative to clone self
             y: 0.0,
             z: 0.0 });
        Tweener.addTween(
            this.clone,
            {opacity: 255,
             x: monitor.width * 0.8 - this.target_width_side / 2,
             y: (monitor.height - this.target_height_side) / 2,
             width: this.target_width_side,
             height: this.target_height_side,
             rotation_angle_y: -60.0,
             time: 0.25,
             transition: 'easeOutQuad'
            });
        try {
            if (this.isWorkspace) {
                this.clone.get_children().forEach(
                    Lang.bind(this, function(clone) {
                                  if (getTypeString(clone) != "MetaBackgroundActor") {
                                      if (this.cloneCoordinates[clone.toString()]) {
                                          let [x, y] = this.cloneCoordinates[clone.toString()];
                                          clone.set_position(x * SWITCH_ACTOR_SIDE_SCALE, y * SWITCH_ACTOR_SIDE_SCALE);
                                      }
                                      clone.set_scale(SWITCH_ACTOR_SIDE_SCALE, SWITCH_ACTOR_SIDE_SCALE);
                                  } else {
                                      clone.set_scale(this.scale * SWITCH_ACTOR_SIDE_SCALE, this.scale * SWITCH_ACTOR_SIDE_SCALE);
                                  }
                              }));
            } else {
                this.clone.get_children().forEach(
                    Lang.bind(this, function(clone) {
                                  if (this.cloneCoordinates[clone.toString()]) {
                                      let [x, y] = this.cloneCoordinates[clone.toString()];
                                      clone.set_position(x * SWITCH_ACTOR_SIDE_SCALE, y * SWITCH_ACTOR_SIDE_SCALE);
                                  }
                                  clone.set_scale(SWITCH_ACTOR_SIDE_SCALE, SWITCH_ACTOR_SIDE_SCALE);
                              }));
            }
        } catch (x) {
            global.log(x);
            throw x;
        }
    },

    getTitle: function() {
        if (this.isWorkspace) {
            let workspaceIndex = this.window.get_workspace().index() + 1;
            return _("Workspace ") + workspaceIndex;
        } else {
            return this.window.get_title();
        }
    },

    initActorSize: function() {
        let width = 0;
        let height = 0;
        if (this.isWorkspace) {
            width = monitor.width;
            height = monitor.height;

            this.scale = 1.0;
            if (width > monitor.width * SWITCH_ACTOR_SCALE ||
                height > monitor.height * SWITCH_ACTOR_SCALE) {
                this.scale = Math.min(monitor.width * SWITCH_ACTOR_SCALE / width, monitor.height * SWITCH_ACTOR_SCALE / height);
            }
        } else {
            let compositor = this.window.get_compositor_private();
            let texture = compositor.get_texture();
            [width, height] = texture.get_size();

            this.scale = 1.0;
            if (width > monitor.width * SWITCH_ACTOR_SCALE ||
                height > monitor.height * SWITCH_ACTOR_SCALE) {
                this.scale = Math.min(monitor.width * SWITCH_ACTOR_SCALE / width, monitor.height * SWITCH_ACTOR_SCALE / height);
            }
        }

        this.target_width = width * this.scale;
        this.target_height = height * this.scale;
        this.target_width_side = width * this.scale * SWITCH_ACTOR_SIDE_SCALE;
        this.target_height_side = height * this.scale * SWITCH_ACTOR_SIDE_SCALE;
    },

    initActorClone: function() {
        if (this.isWorkspace) {
            [this.clone, this.cloneCoordinates] = getWorkspaceClone(
                this.window.get_workspace().index(),
                this.target_width,
                this.target_height,
                this.scale
            );
        } else {
            try {
                [this.clone, this.cloneCoordinates] = getWindowClone(
                    this.app,
                    this.window,
                    this.target_width,
                    this.target_height,
                    this.scale
                );

            } catch (x) {
                global.log(x);
                throw x;
            }
        }
    }
};

function Switcher() {
    this._init();
}

Switcher.prototype = {
    _init: function() {
        this.windowTitle = null;
        this.modifierMask = null;
        this.currentIndex = 0;
        this.haveModal = false;

        this.actor = new St.Group({ visible: true,
                                    reactive: true,
									clip_to_allocation: true});

        // background
        this.background = new St.Group(
            {style_class: 'alt-tab-switcher',
             visible: true,
             x: 0,
             y: 0,
             opacity: 0,
             width: monitor.width,
             height: monitor.height
            });
        this.background.add_actor(new St.Bin(
                                      {style_class: 'alt-tab-switcher-gradient-top',
                                       visible: true,
                                       x: 0,
                                       y: 0,
                                       width: monitor.width,
                                       height: monitor.height * 9 / 10
                                      }));
        this.background.add_actor(new St.Bin(
                                      {style_class: 'alt-tab-switcher-gradient-bottom',
                                       visible: true,
                                       x: 0,
                                       y: monitor.height * 9 / 10,
                                       width: monitor.width,
                                       height: monitor.height
                                      }));
        this.actor.add_actor(this.background);

        // create previews
        this.previewLayer = new St.Group({ visible: true,
										   clip_to_allocation: true});
        this.previews = [];

        [this.switchWindows, this.switchWorkspaces] = this.getSwitchActors();

        for (let w in this.switchWindows) {
            this.previews.push(this.switchWindows[w]);
            this.previewLayer.add_actor(this.switchWindows[w].clone);
        }

        for (let s in this.switchWorkspaces) {
            this.previews.push(this.switchWorkspaces[s]);
            this.previewLayer.add_actor(this.switchWorkspaces[s].clone);
        }
		
        // Add workspace previews.
        try {
            let workspacePaddingX = 16;
            let workspacePaddingY = 72;
            let workspaceMaxWidth = monitor.width / 5 - workspacePaddingX * 2;
            let workspaceWidth = Math.min(monitor.width / this.workspaceIndexes.length - workspacePaddingX * 2, workspaceMaxWidth);
            let scale = workspaceWidth / monitor.width;
            let workspaceHeight = monitor.height * scale;
            let activeWorkspace = global.screen.get_active_workspace();

            this.workspaceLayer = new St.BoxLayout({visible: true,
                                                    vertical: false});
            this.workspaces = [];

            for (let wi in this.workspaceIndexes) {
                let [workspaceClone, _] = getWorkspaceClone(this.workspaceIndexes[wi], workspaceWidth, workspaceHeight, scale);
                workspaceClone.set_clip(0, 0, workspaceWidth, workspaceHeight);
                let workspaceCloneBin = new St.Bin({x_fill: true, y_fill: true});
                workspaceCloneBin.set_opacity(0);
                workspaceCloneBin.set_size(
                    workspaceWidth + workspacePaddingX * 2,
                    workspaceHeight + workspacePaddingY * 2
                );
                workspaceCloneBin.child = workspaceClone;
                this.workspaceLayer.add(workspaceCloneBin);

                this.workspaces.push(workspaceCloneBin);
            }

            this.workspaceLayer.set_position(
                (monitor.width - (workspaceWidth + workspacePaddingX * 2) * this.workspaceIndexes.length) / 2 + workspacePaddingX,
                monitor.height - workspaceHeight - workspacePaddingY);

            for (let wl in this.workspaces) {
                Tweener.addTween(
                    this.workspaces[wl],
                    {
                        opacity: 255,
                        time: 1,
                        transition: 'easeOutQuad'
                    }
                );
            }

            this.actor.add_actor(this.previewLayer);
            this.actor.add_actor(this.workspaceLayer);
        } catch (x) {
            global.log(x);
            throw x;
        }
        Main.uiGroup.add_actor(this.actor);
    },

    isWindowOnWorkspace: function(w, workspace) {
        if (w.get_workspace() == workspace)
            return true;
        return false;
    },

    sortAppIcon : function(appIcon1, appIcon2) {
        let t1 = appIcon1.window.get_user_time();
        let t2 = appIcon2.window.get_user_time();
        if (t2 > t1) return 1;
        else return -1;
    },

    getSwitchActors: function() {
        let activeWorkspace = global.screen.get_active_workspace();
        let windowActors = [];
        let otherWorkspaces = {};
        let apps = Shell.AppSystem.get_default().get_running ();

        for (let i in apps) {
            let windows = apps[i].get_windows();
            for(let j in windows) {
                let switchActor = new SwitchActor(apps[i], windows[j]);

                if (this.isWindowOnWorkspace(windows[j], activeWorkspace)) {
                    // Add application in current workspace to list.
                    windowActors.push(switchActor);
                } else {
                    // Add other worspace.
                    let workspaceIndex = windows[j].get_workspace().index();
                    if (otherWorkspaces[workspaceIndex]) {
                        if (switchActor.window.get_user_time() > otherWorkspaces[workspaceIndex].window.get_user_time()) {
                            // Update topest application in workspace dict.
                            otherWorkspaces[workspaceIndex] = switchActor;
                        }
                    } else {
                        // Fill workspace this is first application.
                        otherWorkspaces[workspaceIndex] = switchActor;
                    }
                }
            }
        }

        windowActors.sort(Lang.bind(this, this.sortAppIcon));

        let workspaceActors = [];

        // Sort workspace by index.
        let keys = [];
        for (k in otherWorkspaces) {
            keys.push(k);
        }
        keys.sort();

        this.workspaceIndexes = [];

        for (let jj in keys) {
            // Push workspace actor.
            workspaceActors.push(otherWorkspaces[keys[jj]]);

            // Push workspace index.
            this.workspaceIndexes.push(keys[jj]);
        }

        // Push active workspace index.
        this.workspaceIndexes.push(activeWorkspace.index());

        // Sort workspace index.
        this.workspaceIndexes.sort();

        // Add last workspace index.
        this.workspaceIndexes.push(this.workspaceIndexes[this.workspaceIndexes.length - 1] + 1);

        return [windowActors, workspaceActors];
    },

    show: function(shellwm, binding, mask, window, backwards) {
        if (!Main.pushModal(this.actor)) {
            return false;
        }

        this.haveModal = true;
        this.modifierMask = AltTab.primaryModifier(mask);

        this.actor.connect('key-press-event', Lang.bind(this, this.keyPressEvent));
        this.actor.connect('key-release-event', Lang.bind(this, this.keyReleaseEvent));
        this.actor.show();

        // hide all window actors
        let windows = global.get_window_actors();
        for (let i in windows) {
            windows[i].hide();
        }

        this.next();

        // There's a race condition; if the user released Alt before
        // we gotthe grab, then we won't be notified. (See
        // https://bugzilla.gnome.org/show_bug.cgi?id=596695 for
        // details) So we check now. (Have to do this after updating
        // selection.)
        let [x, y, mods] = global.get_pointer();
        if (!(mods & this.modifierMask)) {
            this.activateSelected();
            return false;
        }

        Tweener.addTween(this.background, {
                             opacity: 255,
                             time: 0.25,
                             transition: 'easeOutQuad'
                         });

        return true;
    },

    next: function() {
        this.currentIndex = (this.currentIndex + 1) % this.previews.length;
        this.updateCoverflow();
    },

    previous: function() {
        this.currentIndex = (this.currentIndex + this.previews.length - 1) % this.previews.length;
        this.updateCoverflow();
    },

    home: function() {
        this.currentIndex = 0;
        this.updateCoverflow();
    },

    end: function() {
        this.currentIndex = this.previews.length - 1;
        this.updateCoverflow();
    },

    updateCoverflow: function() {
        // window title label
        if (this.windowTitle) {
            Tweener.addTween(this.windowTitle, {
                                 opacity: 0,
                                 time: 0.25,
                                 transition: 'easeOutQuad',
                                 onComplete: Lang.bind(this.background, this.background.remove_actor, this.windowTitle)
                             });
        }
        this.windowTitle = new St.Label(
            {style_class: 'alt-tab-window-title-label',
             text: this.previews[this.currentIndex].getTitle(),
             opacity: 0
            });
        this.background.add_actor(this.windowTitle);
		let [panelWidth, panelHeight] = Main.panel.actor.get_size();
        this.windowTitle.x = (monitor.width - this.windowTitle.width) / 2;
        this.windowTitle.y = panelHeight + monitor.height / 40;
        Tweener.addTween(this.windowTitle, {
                             opacity: 255,
                             time: 0.25,
                             transition: 'easeOutQuad'
                         });

        // preview windows
        for (let i in this.previews) {
            let preview = this.previews[i];

            if (i == this.currentIndex) {
                preview.moveToCenter();
            } else if (i < this.currentIndex) {
                preview.moveToLeft(i - this.currentIndex);
            } else if (i > this.currentIndex) {
                preview.moveToRight(i - this.currentIndex);
            }
        }
    },

    keyPressEvent: function(actor, event) {
        let keysym = event.get_key_symbol();
        let event_state = Shell.get_event_state(event);

        let backwards = event_state & Clutter.ModifierType.SHIFT_MASK;
        let action = global.display.get_keybinding_action(event.get_key_code(), event_state);

        if (keysym == Clutter.Escape) {
            this.destroy();
        } else if (keysym == Clutter.Right ||
                   action == Meta.KeyBindingAction.SWITCH_GROUP ||
                   action == Meta.KeyBindingAction.SWITCH_WINDOWS ||
                   action == Meta.KeyBindingAction.SWITCH_PANELS) {
            backwards ? this.previous() : this.next();
        } else if (keysym == Clutter.Left ||
                   action == Meta.KeyBindingAction.SWITCH_GROUP_BACKWARD ||
                   action == Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD) {
            this.previous();
        } else if (keysym == Clutter.Home) {
            this.home();
        } else if (keysym == Clutter.End) {
            this.end();
        } else {
            let numKey = keysym - Clutter.KEY_0;
            if (numKey > 0 && numKey < 10) {
                if (this.workspaceIndexes[numKey - 1]) {
                    global.screen.get_workspace_by_index(numKey - 1).activate(global.get_current_time());
                    this.destroy();
                }
            }
        }

        return true;
    },

    keyReleaseEvent: function(actor, event) {
        let [x, y, mods] = global.get_pointer();
        let state = mods & this.modifierMask;

        if (state == 0) {
            this.activateSelected();
        }

        return true;
    },

    activateSelected: function() {
        Main.activateWindow(this.getCurrentWindow());

        this.destroy();
    },

    onHideBackgroundCompleted: function() {
        Main.uiGroup.remove_actor(this.actor);

        // show all window actors
        let windows = global.get_window_actors();
        for (let i in windows) {
            windows[i].show();
        }
    },

    getWindowByIndex: function(index) {
        return this.previews[index].window;
    },

    getCurrentWindow: function() {
        return this.getWindowByIndex(this.currentIndex);
    },

    onDestroy: function() {
        // preview windows
        for (let i in this.previews) {
            let preview = this.previews[i];
            let metaWin = this.getWindowByIndex(i);
            let compositor = metaWin.get_compositor_private();

            Tweener.addTween(
                preview.clone,
                {opacity: 255,
                 x: compositor.x,
                 y: compositor.y,
                 width: compositor.width,
                 height: compositor.height,
                 rotation_angle_y: 0.0,
                 time: 0.25,
                 transition: 'easeOutQuad'
                });
        }

        // Remove background.
        Tweener.removeTweens(this.background);
        Tweener.addTween(
            this.background,
            {opacity: 0,
             time: 0.25,
             transition: 'easeOutQuad',
             onComplete: Lang.bind(this, this.onHideBackgroundCompleted)
            });

        // Remove workspace layer.
        for (let wl in this.workspaces) {
            Tweener.addTween(
                this.workspaces[wl],
                {
                    opacity: 0,
                    time: 0.25,
                    transition: 'easeOutQuad'
                }
            );
        }

        if (this.haveModal) {
            Main.popModal(this.actor);
            this.haveModal = false;
        }

        this.windowTitle = null;
        this.previews = null;
        this.previewLayer = null;
    },

    destroy: function() {
        this.onDestroy();
    }
};

function startWindowSwitcher(shellwm, binding, mask, window, backwards) {
    switcher = new Switcher();

    if (!switcher.show(shellwm, binding, mask, window, backwards)) {
        switcher.destroy();
    }
}

function init(extensionMeta) {
    monitor = Main.layoutManager.primaryMonitor;
    Gettext.bindtextdomain('alt-tab', extensionMeta.path + '/locale');
    _ = Gettext.domain('alt-tab').gettext;
}

function enable() {
    Main.wm.setKeybindingHandler('switch_windows', startWindowSwitcher);
    Main.wm.setKeybindingHandler('switch_group', startWindowSwitcher);
    Main.wm.setKeybindingHandler('switch_windows_backward', startWindowSwitcher);
    Main.wm.setKeybindingHandler('switch_panels', startWindowSwitcher);
    Main.wm.setKeybindingHandler('switch_group_backward', startWindowSwitcher);
}

function disable() {
    Main.wm.setKeybindingHandler('switch_windows', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
    Main.wm.setKeybindingHandler('switch_group', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
    Main.wm.setKeybindingHandler('switch_panels', Lang.bind(Main.wm, Main.wm._startA11ySwitcher));
    Main.wm.setKeybindingHandler('switch_windows_backward', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
    Main.wm.setKeybindingHandler('switch_group_backward', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
}
