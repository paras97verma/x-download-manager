use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub fn create_native_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // macOS App Menu
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "X Download Manager",
        true,
        &[
            &MenuItem::with_id(app, "about", "About X Download Manager", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "preferences",
                "Preferences...",
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // File Menu
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "add_url", "Add URL...", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(
                app,
                "add_torrent",
                "Add Torrent / Magnet...",
                true,
                Some("CmdOrCtrl+T"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            #[cfg(not(target_os = "macos"))]
            &MenuItem::with_id(app, "preferences", "Settings...", true, Some("CmdOrCtrl+,"))?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // Edit Menu
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "select_all", "Select All", true, Some("CmdOrCtrl+A"))?,
            &MenuItem::with_id(app, "deselect_all", "Deselect All", true, Some("Escape"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "delete_selected",
                "Remove from List",
                true,
                Some("Delete"),
            )?,
            &MenuItem::with_id(
                app,
                "delete_disk",
                "Delete File from Disk",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // View Menu
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(
                app,
                "toggle_ui_mode",
                "Switch UI Mode (Simple / Advanced)",
                true,
                Some("CmdOrCtrl+M"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    // Downloads Menu
    let downloads_menu = Submenu::with_items(
        app,
        "Downloads",
        true,
        &[
            &MenuItem::with_id(
                app,
                "resume_selected",
                "Resume Selected",
                true,
                Some("Space"),
            )?,
            &MenuItem::with_id(app, "pause_selected", "Pause Selected", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "restart_selected",
                "Restart Selected from 0%",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, "stop_all", "Stop All Transfers", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "open_file",
                "Open Downloaded File",
                true,
                Some("Enter"),
            )?,
            &MenuItem::with_id(
                app,
                "show_in_folder",
                "Reveal in Finder / Explorer",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // Scheduler Menu
    let scheduler_menu = Submenu::with_items(
        app,
        "Scheduler",
        true,
        &[&MenuItem::with_id(
            app,
            "open_scheduler",
            "XDM Queues & Scheduler...",
            true,
            None::<&str>,
        )?],
    )?;

    // Tools Menu
    let tools_menu = Submenu::with_items(
        app,
        "Tools",
        true,
        &[
            &MenuItem::with_id(
                app,
                "open_extensions",
                "Browser Extensions & Integration...",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "open_vault",
                "Site Logins & Auth Vault...",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "open_speed",
                "Speed Limiter Settings...",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // Window Menu
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    // Help Menu
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(
                app,
                "shortcuts_guide",
                "Keyboard Shortcuts Guide",
                true,
                Some("CmdOrCtrl+/"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "about", "About X Download Manager", true, None::<&str>)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &view_menu,
                &downloads_menu,
                &scheduler_menu,
                &tools_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        Menu::with_items(
            app,
            &[
                &file_menu,
                &edit_menu,
                &view_menu,
                &downloads_menu,
                &scheduler_menu,
                &tools_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }
}
