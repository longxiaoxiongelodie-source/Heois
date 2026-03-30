#[cfg(target_os = "ios")]
use std::ffi::CStr;

#[cfg(target_os = "ios")]
use objc::{class, msg_send, sel, sel_impl};

#[cfg(target_os = "ios")]
use objc::runtime::Object;

#[cfg(target_os = "ios")]
fn ios_nsstring(value: &str) -> *mut Object {
    unsafe {
        let ns_string: *mut Object = msg_send![class!(NSString), alloc];
        let ns_string: *mut Object =
            msg_send![ns_string, initWithBytes:value.as_ptr() length:value.len() encoding:4usize];
        ns_string
    }
}

#[cfg(target_os = "ios")]
fn ios_app() -> *mut Object {
    unsafe { msg_send![class!(UIApplication), sharedApplication] }
}

#[tauri::command]
fn get_current_app_icon() -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    unsafe {
        let app = ios_app();
        let current: *mut Object = msg_send![app, alternateIconName];
        if current.is_null() {
            return Ok(None);
        }
        let utf8_ptr: *const std::os::raw::c_char = msg_send![current, UTF8String];
        if utf8_ptr.is_null() {
            return Ok(None);
        }
        return Ok(Some(CStr::from_ptr(utf8_ptr).to_string_lossy().into_owned()));
    }

    #[cfg(not(target_os = "ios"))]
    {
        Ok(None)
    }
}

#[tauri::command]
fn set_app_icon(icon_name: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    unsafe {
        let app = ios_app();
        let supports: bool = msg_send![app, supportsAlternateIcons];
        if !supports {
            return Err("当前系统不支持切换 App 图标".into());
        }
        let alt_name: *mut Object = match icon_name.as_deref() {
            Some(name) if !name.is_empty() => ios_nsstring(name),
            _ => std::ptr::null_mut(),
        };
        let _: () = msg_send![app, setAlternateIconName: alt_name completionHandler: std::ptr::null_mut::<Object>()];
        return Ok(());
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = icon_name;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_current_app_icon, set_app_icon])
        .build(tauri::generate_context!())
        .expect("failed to build MiniStar mobile shell")
        .run(|_, _| {});
}
