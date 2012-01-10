/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

/*
 * Gnome-shell extension specific routines.
 *
 * register/unregister keybinding handlers, etc.
 */

const Lang = imports.lang;
const Main = imports.ui.main;

const Gettext = imports.gettext;

const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const AltTab = imports.ui.altTab;
const Tweener = imports.ui.tweener;

let SWITCH_ACTOR_SCALE = 0.5;
let switcher = null;
let _;

function SwitchActor(app, window) {
    this._init(app, window);
}

SwitchActor.prototype = {
    _init : function(app, window) {
        this.app = app;
        this.window = window;
        let activeWorkspace = global.screen.get_active_workspace();
        this.isWorkspace = !(window.get_workspace() == activeWorkspace);

        if (this.isWorkspace) {
            this.initWorkspaceClone();
        } else {
            this.initWindowClone();
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

    initWorkspaceClone: function() {
        // Get monitor size and scale value.
        let workspaceIndex = this.window.get_workspace().index();
        let monitor = Main.layoutManager.primaryMonitor;
        let width = monitor.width;
        let height = monitor.height;

        let scale = 1.0;
        if (width > monitor.width * SWITCH_ACTOR_SCALE ||
            height > monitor.height * SWITCH_ACTOR_SCALE) {
            scale = Math.min(monitor.width * SWITCH_ACTOR_SCALE / width, monitor.height * SWITCH_ACTOR_SCALE / height);
        }

        // Create actor group.
        this.clone = new Clutter.Group(
            {clip_to_allocation: true,
             rotation_center_y: new Clutter.Vertex({ x: width * scale / 2, y: 0.0, z: 0.0 }),
             reactive: false
            });
        this.clone.set_size(monitor.width, monitor.height);

        // Add background.
        let background = Meta.BackgroundActor.new_for_screen(global.screen);
        background.set_scale(scale, scale);
        this.clone.add_actor(background);

        // Add panel.
        let [panelWidth, panelHeight] = Main.panel.actor.get_size();
        let panel = new Clutter.Clone(
            {source: Main.panel.actor,
             reactive: false,
             x: 0,
             y: 0,
             width: panelWidth * scale,
             height: panelHeight * scale
            }
        );
        this.clone.add_actor(panel);

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
        workspaceWindows.sort(Lang.bind(this, this.sortWindow));

        // Add workspace windows.
        for (let ii in workspaceWindows) {
            let windowTexture = workspaceWindows[ii].get_compositor_private().get_texture();
            let rect = workspaceWindows[ii].get_outer_rect();
            let windowClone = new Clutter.Clone(
                {source: windowTexture,
                 reactive: false,
                 x: rect.x * scale,
                 y: rect.y * scale,
                 width: rect.width * scale,
                 height: rect.height * scale
                });

            this.clone.add_actor(windowClone);
        }

        this.target_width = width * scale;
        this.target_height = height * scale;
        this.target_width_side = width * scale * 0.5;
        this.target_height_side = height * scale * 0.7;
    },

    sortWindow : function(window1, window2) {
        let t1 = window1.get_user_time();
        let t2 = window2.get_user_time();
        if (t2 < t1) {
            return 1;
        } else {
            return -1;
        }
    },

    initWindowClone: function() {
        let currentWorkspace = global.screen.get_active_workspace();
        let monitor = Main.layoutManager.primaryMonitor;
        let compositor = this.window.get_compositor_private();
        let texture = compositor.get_texture();
        let [width, height] = texture.get_size();

        let scale = 1.0;
        if (width > monitor.width * SWITCH_ACTOR_SCALE ||
            height > monitor.height * SWITCH_ACTOR_SCALE) {
            scale = Math.min(monitor.width * SWITCH_ACTOR_SCALE / width, monitor.height * SWITCH_ACTOR_SCALE / height);
        }

        // this.clone = new Clutter.Group({clip_to_allocation: false});
        // this.clone = new Clutter.Group({clip_to_allocation: true});
        // this.clone = new Clutter.Box();
        // this.clone.set_size(width * scale, height * scale);

        // let windowClone = new Clutter.Clone(

        this.clone = new Clutter.Clone(
            {opacity: (this.window.get_workspace() == currentWorkspace || this.window.is_on_all_workspaces()) ? 255 : 0,
             source: texture,
             reactive: false,
             rotation_center_y: new Clutter.Vertex({ x: width * scale / 2, y: 0.0, z: 0.0 }),
             x: compositor.x,
             y: compositor.y
            });

        // this.clone.add_actor(windowClone);

        // // If you found icon not alignment with window clone, it's not fault of program.
        // // Because some icon's have blank pixel around icon.
        // let appIconBoxSize = 42;
        // let appIcon = this.app.create_icon_texture(appIconBoxSize);
        // let appIconBox = new St.Bin();
        // appIconBox.set_position(windowX + windowWidth - appIconBoxSize,
        //                         windowY + windowHeight - appIconBoxSize);
        // appIconBox.add_actor(appIcon);
        // cloneBox.add_actor(appIconBox);

        this.target_width = width * scale;
        this.target_height = height * scale;
        this.target_width_side = width * scale * 0.5;
        this.target_height_side = height * scale * 0.7;
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

        let monitor = Main.layoutManager.primaryMonitor;
        this.actor = new St.Group({ visible: true });

        // background
        this.background = new St.Group(
            {style_class: 'coverflow-switcher',
             visible: true,
             x: 0,
             y: 0,
             opacity: 0,
             width: monitor.width,
             height: monitor.height
            });
        this.background.add_actor(new St.Bin(
                                      {style_class: 'coverflow-switcher-gradient',
                                       visible: true,
                                       x: 0,
                                       y: monitor.height / 2,
                                       width: monitor.width,
                                       height: monitor.height / 2
                                      }));
        this.actor.add_actor(this.background);

        // create previews
        let currentWorkspace = global.screen.get_active_workspace();
        this.previewLayer = new St.Group({ visible: true });
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

        this.actor.add_actor(this.previewLayer);
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

        for (let jj in keys) {
            workspaceActors.push(otherWorkspaces[keys[jj]]);
        }

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
        let monitor = Main.layoutManager.primaryMonitor;

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
            {style_class: 'modal-dialog',
             text: this.previews[this.currentIndex].getTitle(),
             opacity: 0
            });
        this.windowTitle.add_style_class_name('run-dialog');
        this.windowTitle.add_style_class_name('coverflow-window-title-label');
        this.background.add_actor(this.windowTitle);
        this.windowTitle.x = (monitor.width - this.windowTitle.width) / 2;
        this.windowTitle.y = monitor.height / 6;
        Tweener.addTween(this.windowTitle, {
                             opacity: 255,
                             time: 0.25,
                             transition: 'easeOutQuad'
                         });

        // preview windows
        for (let i in this.previews) {
            let preview = this.previews[i];

            if (i == this.currentIndex) {
                preview.clone.raise_top();
                Tweener.addTween(
                    preview.clone,
                    {opacity: 255,
                     x: (monitor.width - preview.target_width) / 2,
                     y: (monitor.height - preview.target_height) / 2,
                     width: preview.target_width,
                     height: preview.target_height,
                     rotation_angle_y: 0.0,
                     time: 0.25,
                     transition: 'easeOutQuad'
                    });
            } else if (i < this.currentIndex) {
                preview.clone.raise_top();
                Tweener.addTween(
                    preview.clone,
                    {opacity: 250,
                     x: monitor.width * 0.2 - (preview.target_width_side * 2 / 5) / 2 + 25 * (i - this.currentIndex),
                     y: (monitor.height - preview.target_height_side * 3 / 5) / 2,
                     width: preview.target_width_side * 3 / 5,
                     height: preview.target_height_side * 3 / 5,
                     rotation_angle_y: 60.0,
                     time: 0.25,
                     transition: 'easeOutQuad'
                    });
            } else if (i > this.currentIndex) {
                preview.clone.lower_bottom();
                Tweener.addTween(
                    preview.clone,
                    {opacity: 250,
                     x: monitor.width * 0.8 - preview.target_width_side / 2 + 25 * (i - this.currentIndex),
                     y: (monitor.height - preview.target_height_side) / 2,
                     width: preview.target_width_side,
                     height: preview.target_height_side,
                     rotation_angle_y: -60.0,
                     time: 0.25,
                     transition: 'easeOutQuad'
                    });
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
        let currentWorkspace = global.screen.get_active_workspace();
        let windows = global.get_window_actors();
        for (let i in windows) {
            let metaWin = windows[i].get_meta_window();
            if (metaWin.get_workspace() == currentWorkspace || metaWin.is_on_all_workspaces()) {
                windows[i].show();
            }
        }
    },

    getWindowByIndex: function(index) {
        return this.previews[index].window;
    },

    getCurrentWindow: function() {
        return this.getWindowByIndex(this.currentIndex);
    },

    onDestroy: function() {
        let monitor = Main.layoutManager.primaryMonitor;

        // preview windows
        let currentWorkspace = global.screen.get_active_workspace();
        for (let i in this.previews) {
            let preview = this.previews[i];
            let metaWin = this.getWindowByIndex(i);
            let compositor = metaWin.get_compositor_private();

            Tweener.addTween(
                preview.clone,
                {opacity: (metaWin.get_workspace() == currentWorkspace || metaWin.is_on_all_workspaces()) ? 255 : 0,
                 x: compositor.x,
                 y: compositor.y,
                 width: compositor.width,
                 height: compositor.height,
                 rotation_angle_y: 0.0,
                 time: 0.25,
                 transition: 'easeOutQuad'
                });
        }

        // background
        Tweener.removeTweens(this.background);
        Tweener.addTween(
            this.background,
            {opacity: 0,
             time: 0.25,
             transition: 'easeOutQuad',
             onComplete: Lang.bind(this, this.onHideBackgroundCompleted)
            });

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
    let localePath = extensionMeta.path + '/locale';
    Gettext.bindtextdomain('alt-tab', localePath);
    _ = Gettext.domain('alt-tab').gettext;
}

function enable() {
    Main.wm.setKeybindingHandler('switch_windows', startWindowSwitcher);
    Main.wm.setKeybindingHandler('switch_group', startWindowSwitcher);
    Main.wm.setKeybindingHandler('switch_panels', startWindowSwitcher);
    Main.wm.setKeybindingHandler('switch_windows_backward', startWindowSwitcher);
    Main.wm.setKeybindingHandler('switch_group_backward', startWindowSwitcher);
}

function disable() {
    Main.wm.setKeybindingHandler('switch_windows', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
    Main.wm.setKeybindingHandler('switch_group', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
    Main.wm.setKeybindingHandler('switch_panels', Lang.bind(Main.wm, Main.wm._startA11ySwitcher));
    Main.wm.setKeybindingHandler('switch_windows_backward', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
    Main.wm.setKeybindingHandler('switch_group_backward', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
}
