//! Virtual Wi-Fi and network for ESP-IDF / Arduino-ESP32 firmware.
//!
//! The radio is not emulated. The Wi-Fi driver API (`esp_wifi_*`) is answered here instead: a
//! virtual access point accepts any SSID and password, and the driver posts the events the
//! real one does (STA_START, STA_CONNECTED, SCAN_DONE...), so esp_netif and Arduino's `WiFi`
//! run unchanged. The station gets [`STA_IP`]: its DHCP client reports "stopped" and
//! `esp_netif_get_ip_info` reports the address, which makes esp_netif post IP_EVENT_STA_GOT_IP
//! itself as it does for a static IP.
//!
//! lwIP's TCP socket API (`lwip_socket`, `connect`, `send`, `recv`, `select`...) and
//! `getaddrinfo` are answered here too, so lwIP's own TCP/IP stack never sends a packet. A
//! socket is a byte stream carried by the host: the emulator queues [`NetOp`]s (connect, send,
//! close, resolve) and the host reports back through [`Net::connected`], [`Net::received`],
//! [`Net::closed`], [`Net::failed`] and [`Net::resolved`]. The command-line runner opens real
//! TCP connections; the browser goes through the lab server.
//!
//! A blocking call that is not ready (a `select` with a timeout, a blocking `recv`, a DNS
//! lookup) sleeps one FreeRTOS tick and runs again, so other tasks go on meanwhile.
//!
//! Not modelled: UDP, incoming connections (`accept` never has a client), IPv6, clients of the
//! soft-AP.

use crate::rom::{Action, Call, Then};
use crate::soc::CPU_HZ;
use std::collections::{HashMap, VecDeque};

/// The station's address on the virtual network, its gateway and netmask.
pub const STA_IP: [u8; 4] = [10, 0, 2, 15];
pub const GATEWAY: [u8; 4] = [10, 0, 2, 2];
pub const NETMASK: [u8; 4] = [255, 255, 255, 0];
pub const DNS: [u8; 4] = [10, 0, 2, 3];
const BSSID: [u8; 6] = [0x02, 0x00, 0x00, 0x00, 0x00, 0x01];
const CHANNEL: u8 = 6;
const RSSI: i8 = -55;
/// Shown by a scan when the firmware has not configured a network yet.
const DEFAULT_SSID: &[u8] = b"ESP32-Lab";

/// Emulator-only RAM for data handed to the firmware (event payloads, addrinfo results).
/// Reserved address space on the real chip.
pub const SCRATCH_BASE: u32 = 0x3ff8_8000;
pub const SCRATCH_SIZE: u32 = 0x1000;
const SLOT_EVENT: u32 = SCRATCH_BASE;
const SLOT_ADDRINFO: u32 = SCRATCH_BASE + 0x400;
const ADDRINFO_SLOTS: u32 = 16;
const ADDRINFO_SIZE: u32 = 48;

/// lwIP socket descriptors: LWIP_SOCKET_OFFSET (FD_SETSIZE − CONFIG_LWIP_MAX_SOCKETS) up to
/// FD_SETSIZE, the range esp_vfs_lwip_sockets_register claims.
const FD_BASE: i32 = 48;
const FD_END: i32 = 64;

const ESP_OK: u32 = 0;
const ESP_ERR_WIFI_NOT_INIT: u32 = 0x3001;
const ESP_ERR_WIFI_NOT_STARTED: u32 = 0x3002;
const ESP_ERR_WIFI_MODE: u32 = 0x3005;
const ESP_ERR_WIFI_NOT_CONNECT: u32 = 0x300f;

const WIFI_EVENT_SCAN_DONE: u32 = 1;
const WIFI_EVENT_STA_START: u32 = 2;
const WIFI_EVENT_STA_STOP: u32 = 3;
const WIFI_EVENT_STA_CONNECTED: u32 = 4;
const WIFI_EVENT_STA_DISCONNECTED: u32 = 5;
const WIFI_EVENT_AP_START: u32 = 12;
const WIFI_EVENT_AP_STOP: u32 = 13;
const WIFI_REASON_ASSOC_LEAVE: u8 = 8;
const WIFI_REASON_NO_AP_FOUND: u8 = 201;
const WIFI_AUTH_OPEN: u32 = 0;
const WIFI_AUTH_WPA2_PSK: u32 = 3;
const WIFI_CONFIG_SIZE: u32 = 184;
const MODE_STA: u32 = 1;
const MODE_AP: u32 = 2;

// newlib errno values
const EBADF: u32 = 9;
const EAGAIN: u32 = 11;
const EINVAL: u32 = 22;
const ENFILE: u32 = 23;
const ENOSYS: u32 = 88;
const ECONNRESET: u32 = 104;
const EAFNOSUPPORT: u32 = 106;
const EINPROGRESS: u32 = 119;
const EALREADY: u32 = 120;
const EPROTONOSUPPORT: u32 = 123;
const EISCONN: u32 = 127;
const ENOTCONN: u32 = 128;
pub const ECONNREFUSED: u32 = 111;
pub const ETIMEDOUT: u32 = 116;
pub const EHOSTUNREACH: u32 = 118;

// lwIP socket constants
const AF_INET: u32 = 2;
const SOCK_STREAM: u32 = 1;
const SOL_SOCKET: u32 = 0xfff;
const SO_RCVTIMEO: u32 = 0x1006;
const SO_ERROR: u32 = 0x1007;
const SO_TYPE: u32 = 0x1008;
const MSG_PEEK: u32 = 0x01;
const MSG_DONTWAIT: u32 = 0x08;
const F_GETFL: u32 = 3;
const F_SETFL: u32 = 4;
const O_RDWR: u32 = 2;
const O_NONBLOCK: u32 = 0x4000;
const FIONREAD: u32 = 0x4004_667f;
const FIONBIO: u32 = 0x8004_667e;
const EAI_FAIL: u32 = 202;
const EAI_FAMILY: u32 = 204;
const PORT_MAX_DELAY: u32 = u32::MAX;

/// How long a DNS lookup waits for the host before failing.
const DNS_TIMEOUT: u64 = 10 * CPU_HZ;

/// Firmware functions answered here (those the firmware does not contain are skipped).
pub const HOOKS: &[&str] = &[
    // Wi-Fi driver
    "esp_wifi_init",
    "esp_wifi_deinit",
    "esp_wifi_start",
    "esp_wifi_stop",
    "esp_wifi_restore",
    "esp_wifi_connect",
    "esp_wifi_disconnect",
    "esp_wifi_set_mode",
    "esp_wifi_get_mode",
    "esp_wifi_set_config",
    "esp_wifi_get_config",
    "esp_wifi_set_ps",
    "esp_wifi_get_ps",
    "esp_wifi_get_mac",
    "esp_wifi_set_mac",
    "esp_wifi_set_storage",
    "esp_wifi_set_band_mode",
    "esp_wifi_get_band_mode",
    "esp_wifi_set_protocol",
    "esp_wifi_get_protocol",
    "esp_wifi_set_protocols",
    "esp_wifi_get_protocols",
    "esp_wifi_set_bandwidth",
    "esp_wifi_get_bandwidth",
    "esp_wifi_set_bandwidths",
    "esp_wifi_get_bandwidths",
    "esp_wifi_set_channel",
    "esp_wifi_get_channel",
    "esp_wifi_set_country",
    "esp_wifi_get_country",
    "esp_wifi_set_country_code",
    "esp_wifi_get_country_code",
    "esp_wifi_set_max_tx_power",
    "esp_wifi_get_max_tx_power",
    "esp_wifi_set_inactive_time",
    "esp_wifi_set_event_mask",
    "esp_wifi_set_promiscuous",
    "esp_wifi_set_rssi_threshold",
    "esp_wifi_set_vendor_ie",
    "esp_wifi_set_keep_alive_time",
    "esp_wifi_set_sleep_min_active_time",
    "esp_wifi_set_sleep_wait_broadcast_data_time",
    "esp_wifi_config_11b_rate",
    "esp_wifi_sta_get_ap_info",
    "esp_wifi_sta_get_rssi",
    "esp_wifi_sta_get_aid",
    "esp_wifi_scan_start",
    "esp_wifi_scan_stop",
    "esp_wifi_scan_get_ap_num",
    "esp_wifi_scan_get_ap_records",
    "esp_wifi_scan_get_ap_record",
    "esp_wifi_clear_ap_list",
    "esp_wifi_internal_reg_rxcb",
    "esp_wifi_internal_reg_netstack_buf_cb",
    "esp_wifi_internal_set_sta_ip",
    "esp_wifi_internal_tx",
    "esp_wifi_internal_tx_by_ref",
    "esp_wifi_internal_free_rx_buffer",
    // esp_netif / lwIP DHCP
    "esp_netif_get_ip_info",
    "esp_netif_dhcpc_get_status",
    "esp_netif_get_dns_info",
    "dhcp_start",
    // lwIP sockets
    "lwip_socket",
    "lwip_close",
    "lwip_connect",
    "lwip_bind",
    "lwip_listen",
    "lwip_accept",
    "lwip_shutdown",
    "lwip_send",
    "lwip_sendto",
    "lwip_write",
    "lwip_recv",
    "lwip_recvfrom",
    "lwip_read",
    "lwip_select",
    "lwip_fcntl",
    "lwip_ioctl",
    "lwip_setsockopt",
    "lwip_getsockopt",
    "lwip_getpeername",
    "lwip_getsockname",
    "lwip_getaddrinfo",
    "lwip_freeaddrinfo",
];

/// What the emulator asks the host to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetOp {
    /// Open a TCP connection; answer with `connected` or `failed`.
    Connect { conn: u32, ip: [u8; 4], port: u16 },
    Send { conn: u32, data: Vec<u8> },
    Close { conn: u32 },
    /// Look up a host name; answer with `resolved`.
    Resolve { name: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Fresh,
    Connecting,
    Connected,
    /// The peer closed its side: reads drain what is left, then return 0 once.
    PeerClosed,
    /// End of stream was reported: like lwIP, further reads fail with ENOTCONN.
    Eof,
    /// Connection refused / reset: the error is in `Sock::error` until read.
    Failed,
    Listening,
}

struct Sock {
    conn: u32,
    nonblock: bool,
    state: State,
    rx: VecDeque<u8>,
    /// Pending SO_ERROR.
    error: u32,
    remote: ([u8; 4], u16),
    /// SO_RCVTIMEO in µs, 0 = wait forever.
    rcv_timeout_us: u64,
}

enum Dns {
    Pending(u64),
    Found([u8; 4]),
    Failed,
}

pub struct Net {
    mac: [u8; 6],
    inited: bool,
    started: bool,
    connected: bool,
    mode: u32,
    ps: u32,
    sta_config: Vec<u8>,
    ap_config: Vec<u8>,
    scan_results: u16,
    socks: HashMap<i32, Sock>,
    next_conn: u32,
    ops: Vec<NetOp>,
    dns: HashMap<String, Dns>,
    /// Deadlines (CPU cycles) of blocking calls waiting to be retried, by the caller's SP.
    waits: HashMap<u32, u64>,
    addrinfo_next: u32,
    /// Bytes sent and received over all sockets.
    pub tx_bytes: u64,
    pub rx_bytes: u64,
}

impl Net {
    pub fn new(mac: [u8; 6]) -> Self {
        Self {
            mac,
            inited: false,
            started: false,
            connected: false,
            mode: 0,
            ps: 0,
            sta_config: vec![0; WIFI_CONFIG_SIZE as usize],
            ap_config: vec![0; WIFI_CONFIG_SIZE as usize],
            scan_results: 0,
            socks: HashMap::new(),
            next_conn: 1,
            ops: vec![],
            dns: HashMap::new(),
            waits: HashMap::new(),
            addrinfo_next: 0,
            tx_bytes: 0,
            rx_bytes: 0,
        }
    }

    /// Is the station associated with the virtual access point?
    pub fn wifi_connected(&self) -> bool {
        self.connected
    }

    /// The SSID the firmware configured for its station.
    pub fn ssid(&self) -> String {
        String::from_utf8_lossy(&self.sta_ssid()).into_owned()
    }

    fn sta_ssid(&self) -> Vec<u8> {
        let s = &self.sta_config[..32];
        s[..s.iter().position(|&b| b == 0).unwrap_or(32)].to_vec()
    }

    /// Requests for the host since the last call, in order.
    pub fn take_ops(&mut self) -> Vec<NetOp> {
        std::mem::take(&mut self.ops)
    }

    pub fn has_ops(&self) -> bool {
        !self.ops.is_empty()
    }

    fn by_conn(&mut self, conn: u32) -> Option<&mut Sock> {
        self.socks.values_mut().find(|s| s.conn == conn && s.state != State::Fresh)
    }

    /// The host opened connection `conn`.
    pub fn connected(&mut self, conn: u32) {
        if let Some(s) = self.by_conn(conn).filter(|s| s.state == State::Connecting) {
            s.state = State::Connected;
        }
    }

    /// Connection `conn` could not be opened or broke (`errno`: ECONNREFUSED, ETIMEDOUT...).
    pub fn failed(&mut self, conn: u32, errno: u32) {
        if let Some(s) = self.by_conn(conn) {
            if s.state == State::Connected || s.state == State::PeerClosed {
                // Data already received stays readable before the reset shows
                if !s.rx.is_empty() {
                    s.state = State::PeerClosed;
                    return;
                }
            }
            s.state = State::Failed;
            s.error = errno;
        }
    }

    /// Data arrived on connection `conn`.
    pub fn received(&mut self, conn: u32, data: &[u8]) {
        self.rx_bytes += data.len() as u64;
        if let Some(s) = self.by_conn(conn).filter(|s| matches!(s.state, State::Connected | State::Connecting)) {
            s.state = State::Connected;
            s.rx.extend(data);
        }
    }

    /// The peer closed connection `conn`.
    pub fn closed(&mut self, conn: u32) {
        if let Some(s) = self.by_conn(conn).filter(|s| matches!(s.state, State::Connected | State::Connecting)) {
            s.state = State::PeerClosed;
        }
    }

    /// Result of a `Resolve`: the IPv4 address, or None if the name does not exist.
    pub fn resolved(&mut self, name: &str, ip: Option<[u8; 4]>) {
        self.dns.insert(name.to_string(), ip.map_or(Dns::Failed, Dns::Found));
    }
}

fn ip_u32(ip: [u8; 4]) -> u32 {
    u32::from_le_bytes(ip) // network order in memory
}

fn parse_ipv4(s: &str) -> Option<[u8; 4]> {
    let parts: Vec<u8> = s.split('.').map(|p| p.parse().ok()).collect::<Option<_>>()?;
    parts.try_into().ok()
}

/// `esp_event_post(base, id, data, len, portMAX_DELAY)` with `data` copied to scratch RAM.
fn post(c: &mut Call, base: &str, id: u32, data: &[u8]) -> Option<(u32, Vec<u32>)> {
    let func = c.soc.rom.symbol("esp_event_post")?;
    let base_var = c.soc.rom.symbol(base)?;
    let base_ptr = c.r32(base_var);
    // Each event id gets its own slot: one post may still be pending when the next is made
    let slot = SLOT_EVENT + (id % 16) * 64;
    c.write_bytes(slot, data);
    let ptr = if data.is_empty() { 0 } else { slot };
    Some((func, vec![base_ptr, id, ptr, data.len() as u32, PORT_MAX_DELAY]))
}

/// Post these events in order, then return `ret`.
fn post_all(c: &mut Call, events: Vec<(u32, Vec<u8>)>, ret: u32) -> Action {
    let mut calls: Vec<(u32, Vec<u32>)> = events.iter().filter_map(|(id, data)| post(c, "WIFI_EVENT", *id, data)).collect();
    if calls.is_empty() {
        c.ret(ret);
        return Action::Return;
    }
    let mut then = Then::Return(ret);
    while calls.len() > 1 {
        let (f, a) = calls.pop().unwrap();
        then = Then::Chain(f, a, Box::new(then));
    }
    let (f, a) = calls.pop().unwrap();
    Action::Call(f, a, then)
}

fn done(c: &mut Call, v: u32) -> Option<Action> {
    c.ret(v);
    Some(Action::Return)
}

/// Is `netif` the station interface (if_key "WIFI_STA_DEF")?
fn is_sta(c: &mut Call, netif: u32) -> bool {
    if netif == 0 {
        return false;
    }
    let key = c.r32(netif + 92); // esp_netif_obj.if_key
    key != 0 && c.cstr(key) == b"WIFI_STA_DEF"
}

fn sockaddr_in(ip: [u8; 4], port: u16) -> [u8; 16] {
    let mut a = [0u8; 16];
    a[0] = 16;
    a[1] = AF_INET as u8;
    a[2..4].copy_from_slice(&port.to_be_bytes());
    a[4..8].copy_from_slice(&ip);
    a
}

/// The scan's one access point, as a wifi_ap_record_t.
fn ap_record(net: &Net) -> [u8; 92] {
    let mut r = [0u8; 92];
    r[0..6].copy_from_slice(&BSSID);
    let ssid = net.sta_ssid();
    let ssid: &[u8] = if ssid.is_empty() { DEFAULT_SSID } else { &ssid };
    r[6..6 + ssid.len().min(32)].copy_from_slice(&ssid[..ssid.len().min(32)]);
    r[39] = CHANNEL;
    r[44] = RSSI as u8;
    let auth = if net.sta_config[32] != 0 { WIFI_AUTH_WPA2_PSK } else { WIFI_AUTH_OPEN };
    r[48..52].copy_from_slice(&auth.to_le_bytes());
    r[52..56].copy_from_slice(&4u32.to_le_bytes()); // pairwise cipher CCMP
    r[56..60].copy_from_slice(&4u32.to_le_bytes()); // group cipher CCMP
    r[64] = 0b111; // 11b, 11g, 11n
    r[68..71].copy_from_slice(b"01\0");
    r[71] = 1;
    r[72] = 11;
    r[73] = 20;
    r[84..88].copy_from_slice(&1u32.to_le_bytes()); // HT20
    r
}

/// Answer `name` if it is one of [`HOOKS`].
pub(crate) fn call(c: &mut Call, name: &str) -> Option<Action> {
    if name.starts_with("esp_wifi_") {
        wifi(c, name)
    } else if name.starts_with("lwip_") {
        socket(c, name)
    } else {
        match name {
            "esp_netif_get_ip_info" => {
                let (netif, info) = (c.arg(0), c.arg(1));
                if !is_sta(c, netif) || !c.soc.net.connected {
                    return Some(Action::Pass);
                }
                for (k, ip) in [STA_IP, NETMASK, GATEWAY].into_iter().enumerate() {
                    c.w32(info + 4 * k as u32, ip_u32(ip));
                }
                done(c, ESP_OK)
            }
            "esp_netif_dhcpc_get_status" => {
                let (netif, status) = (c.arg(0), c.arg(1));
                if !is_sta(c, netif) {
                    return Some(Action::Pass);
                }
                c.w32(status, 2); // ESP_NETIF_DHCP_STOPPED: the address is "static"
                done(c, ESP_OK)
            }
            "esp_netif_get_dns_info" => {
                let (netif, dns) = (c.arg(0), c.arg(2));
                if !is_sta(c, netif) || !c.soc.net.connected {
                    return Some(Action::Pass);
                }
                c.write_bytes(dns, &[0; 24]);
                c.w32(dns, ip_u32(DNS)); // esp_ip_addr_t, type 0 = IPv4
                done(c, ESP_OK)
            }
            "dhcp_start" => done(c, 0), // ERR_OK, and no DHCP packets
            _ => None,
        }
    }
}

fn wifi(c: &mut Call, name: &str) -> Option<Action> {
    let a = [c.arg(0), c.arg(1), c.arg(2), c.arg(3)];
    match name {
        "esp_wifi_init" => {
            c.soc.net.inited = true;
            done(c, ESP_OK)
        }
        "esp_wifi_deinit" => {
            c.soc.net = Net::new(c.soc.net.mac);
            done(c, ESP_OK)
        }
        "esp_wifi_set_mode" => {
            let mode = a[0];
                        let old = c.soc.net.mode;
            c.soc.net.mode = mode;
            if !c.soc.net.started {
                return done(c, ESP_OK);
            }
            // A running driver starts and stops the interfaces the new mode adds or drops
            let mut events = vec![];
            if old & MODE_STA != 0 && mode & MODE_STA == 0 {
                c.soc.net.connected = false;
                events.push((WIFI_EVENT_STA_STOP, vec![]));
            }
            if old & MODE_AP != 0 && mode & MODE_AP == 0 {
                events.push((WIFI_EVENT_AP_STOP, vec![]));
            }
            if old & MODE_STA == 0 && mode & MODE_STA != 0 {
                events.push((WIFI_EVENT_STA_START, vec![]));
            }
            if old & MODE_AP == 0 && mode & MODE_AP != 0 {
                events.push((WIFI_EVENT_AP_START, vec![]));
            }
            if mode == 0 {
                c.soc.net.started = false;
            }
            Some(post_all(c, events, ESP_OK))
        }
        "esp_wifi_get_mode" => {
            let (p, mode) = (a[0], c.soc.net.mode);
            c.w32(p, mode);
            done(c, ESP_OK)
        }
        "esp_wifi_start" => {
            if !c.soc.net.inited {
                return done(c, ESP_ERR_WIFI_NOT_INIT);
            }
            if c.soc.net.started {
                return done(c, ESP_OK);
            }
            c.soc.net.started = true;
            let mut events = vec![];
            if c.soc.net.mode & MODE_STA != 0 {
                events.push((WIFI_EVENT_STA_START, vec![]));
            }
            if c.soc.net.mode & MODE_AP != 0 {
                events.push((WIFI_EVENT_AP_START, vec![]));
            }
            Some(post_all(c, events, ESP_OK))
        }
        "esp_wifi_stop" => {
            if !c.soc.net.started {
                return done(c, ESP_OK);
            }
            c.soc.net.started = false;
            let mut events = vec![];
            if c.soc.net.connected {
                c.soc.net.connected = false;
                events.push((WIFI_EVENT_STA_DISCONNECTED, disconnected(&c.soc.net, WIFI_REASON_ASSOC_LEAVE)));
            }
            if c.soc.net.mode & MODE_STA != 0 {
                events.push((WIFI_EVENT_STA_STOP, vec![]));
            }
            if c.soc.net.mode & MODE_AP != 0 {
                events.push((WIFI_EVENT_AP_STOP, vec![]));
            }
            Some(post_all(c, events, ESP_OK))
        }
        "esp_wifi_restore" => {
            c.soc.net.sta_config.fill(0);
            c.soc.net.ap_config.fill(0);
            done(c, ESP_OK)
        }
        "esp_wifi_connect" => {
            if !c.soc.net.inited {
                return done(c, ESP_ERR_WIFI_NOT_INIT);
            }
            if !c.soc.net.started {
                return done(c, ESP_ERR_WIFI_NOT_STARTED);
            }
            if c.soc.net.mode & MODE_STA == 0 {
                return done(c, ESP_ERR_WIFI_MODE);
            }
            let ssid = c.soc.net.sta_ssid();
            if ssid.is_empty() {
                let data = disconnected(&c.soc.net, WIFI_REASON_NO_AP_FOUND);
                return Some(post_all(c, vec![(WIFI_EVENT_STA_DISCONNECTED, data)], ESP_OK));
            }
            c.soc.net.connected = true;
            // wifi_event_sta_connected_t
            let mut d = vec![0u8; 48];
            d[..ssid.len().min(32)].copy_from_slice(&ssid[..ssid.len().min(32)]);
            d[32] = ssid.len().min(32) as u8;
            d[33..39].copy_from_slice(&BSSID);
            d[39] = CHANNEL;
            let auth = if c.soc.net.sta_config[32] != 0 { WIFI_AUTH_WPA2_PSK } else { WIFI_AUTH_OPEN };
            d[40..44].copy_from_slice(&auth.to_le_bytes());
            d[44] = 1; // aid
            Some(post_all(c, vec![(WIFI_EVENT_STA_CONNECTED, d)], ESP_OK))
        }
        "esp_wifi_disconnect" => {
            if !c.soc.net.connected {
                return done(c, ESP_OK);
            }
            c.soc.net.connected = false;
            let data = disconnected(&c.soc.net, WIFI_REASON_ASSOC_LEAVE);
            Some(post_all(c, vec![(WIFI_EVENT_STA_DISCONNECTED, data)], ESP_OK))
        }
        "esp_wifi_set_config" => {
            let (ifx, conf) = (a[0], a[1]);
            let bytes = c.read_bytes(conf, WIFI_CONFIG_SIZE);
                        if ifx == 0 { c.soc.net.sta_config = bytes } else { c.soc.net.ap_config = bytes }
            done(c, ESP_OK)
        }
        "esp_wifi_get_config" => {
            let (ifx, conf) = (a[0], a[1]);
            let bytes = if ifx == 0 { c.soc.net.sta_config.clone() } else { c.soc.net.ap_config.clone() };
            c.write_bytes(conf, &bytes);
            done(c, ESP_OK)
        }
        "esp_wifi_set_ps" => {
            c.soc.net.ps = a[0];
            done(c, ESP_OK)
        }
        "esp_wifi_get_ps" => {
            let (p, ps) = (a[0], c.soc.net.ps);
            c.w32(p, ps);
            done(c, ESP_OK)
        }
        "esp_wifi_get_mac" => {
            let (ifx, p) = (a[0], a[1]);
            let mut mac = c.soc.net.mac;
            mac[5] = mac[5].wrapping_add(ifx as u8); // STA = base MAC, soft-AP = base + 1
            c.write_bytes(p, &mac);
            done(c, ESP_OK)
        }
        "esp_wifi_get_band_mode" => {
            let p = a[0];
            c.w32(p, 1); // WIFI_BAND_MODE_2G_ONLY
            done(c, ESP_OK)
        }
        "esp_wifi_get_protocol" => {
            let p = a[1];
            c.w8(p, 0b111); // 11b | 11g | 11n
            done(c, ESP_OK)
        }
        "esp_wifi_get_protocols" => {
            let p = a[1];
            c.w16(p, 0b111);
            c.w16(p + 2, 0);
            done(c, ESP_OK)
        }
        "esp_wifi_get_bandwidth" => {
            let p = a[1];
            c.w32(p, 1); // WIFI_BW_HT20
            done(c, ESP_OK)
        }
        "esp_wifi_get_bandwidths" => {
            let p = a[1];
            c.w32(p, 1);
            c.w32(p + 4, 0);
            done(c, ESP_OK)
        }
        "esp_wifi_get_channel" => {
            let (primary, second) = (a[0], a[1]);
            c.w8(primary, CHANNEL);
            if second != 0 {
                c.w32(second, 0);
            }
            done(c, ESP_OK)
        }
        "esp_wifi_get_country" => {
            let p = a[0];
            c.write_bytes(p, &[b'0', b'1', 0, 1, 11, 20, 0, 0, 0, 0, 0, 0]);
            done(c, ESP_OK)
        }
        "esp_wifi_get_country_code" => {
            let p = a[0];
            c.write_bytes(p, b"01\0");
            done(c, ESP_OK)
        }
        "esp_wifi_get_max_tx_power" => {
            let p = a[0];
            c.w8(p, 80); // 20 dBm in 0.25 dBm steps
            done(c, ESP_OK)
        }
        "esp_wifi_sta_get_ap_info" => {
            if !c.soc.net.connected {
                return done(c, ESP_ERR_WIFI_NOT_CONNECT);
            }
            let (p, rec) = (a[0], ap_record(&c.soc.net));
            c.write_bytes(p, &rec);
            done(c, ESP_OK)
        }
        "esp_wifi_sta_get_rssi" => {
            if !c.soc.net.connected {
                return done(c, ESP_ERR_WIFI_NOT_CONNECT);
            }
            let p = a[0];
            c.w32(p, RSSI as i32 as u32);
            done(c, ESP_OK)
        }
        "esp_wifi_sta_get_aid" => {
            let p = a[0];
            c.w16(p, if c.soc.net.connected { 1 } else { 0 });
            done(c, ESP_OK)
        }
        "esp_wifi_scan_start" => {
            if !c.soc.net.started {
                return done(c, ESP_ERR_WIFI_NOT_STARTED);
            }
            c.soc.net.scan_results = 1;
            // wifi_event_sta_scan_done_t: status 0 = success, one AP
            Some(post_all(c, vec![(WIFI_EVENT_SCAN_DONE, vec![0, 0, 0, 0, 1, 0, 0, 0])], ESP_OK))
        }
        "esp_wifi_scan_get_ap_num" => {
            let (p, n) = (a[0], c.soc.net.scan_results);
            c.w16(p, n);
            done(c, ESP_OK)
        }
        "esp_wifi_scan_get_ap_records" => {
            let (num, recs) = (a[0], a[1]);
            let want = c.r32(num) as u16;
            let n = want.min(c.soc.net.scan_results);
            if n > 0 && recs != 0 {
                let rec = ap_record(&c.soc.net);
                c.write_bytes(recs, &rec);
            }
            c.w16(num, n);
            c.soc.net.scan_results = 0;
            done(c, ESP_OK)
        }
        "esp_wifi_scan_get_ap_record" => {
            if c.soc.net.scan_results == 0 {
                return done(c, 0x3016); // ESP_FAIL-like: no more records
            }
            c.soc.net.scan_results = 0;
            let (p, rec) = (a[0], ap_record(&c.soc.net));
            c.write_bytes(p, &rec);
            done(c, ESP_OK)
        }
        "esp_wifi_clear_ap_list" | "esp_wifi_scan_stop" => {
            c.soc.net.scan_results = 0;
            done(c, ESP_OK)
        }
        // Frames from lwIP (DHCP, ARP, IGMP...) go nowhere: sockets bypass lwIP's stack
        "esp_wifi_internal_tx" | "esp_wifi_internal_tx_by_ref" => done(c, ESP_OK),
        "esp_wifi_internal_free_rx_buffer" => Some(Action::Return),
        // Settings the virtual radio accepts and forgets
        _ => done(c, ESP_OK),
    }
}

/// wifi_event_sta_disconnected_t
fn disconnected(net: &Net, reason: u8) -> Vec<u8> {
    let ssid = net.sta_ssid();
    let mut d = vec![0u8; 41];
    d[..ssid.len().min(32)].copy_from_slice(&ssid[..ssid.len().min(32)]);
    d[32] = ssid.len().min(32) as u8;
    d[33..39].copy_from_slice(&BSSID);
    d[39] = reason;
    d[40] = RSSI as u8;
    d
}

/// Wait for a blocking call: Retry until `deadline_us` (None = forever) passes, keyed by the
/// caller's SP. Returns true once the time is up.
fn timed_out(c: &mut Call, timeout_us: Option<u64>) -> bool {
    let sp = c.soc.cpus[c.core].a(1);
    let now = c.soc.cycles;
    let deadline = *c.soc.net.waits.entry(sp).or_insert(match timeout_us {
        Some(us) => now + us * (CPU_HZ / 1_000_000),
        None => u64::MAX,
    });
    if now >= deadline {
        c.soc.net.waits.remove(&sp);
        return true;
    }
    false
}

fn end_wait(c: &mut Call) {
    let sp = c.soc.cpus[c.core].a(1);
    c.soc.net.waits.remove(&sp);
}

fn socket(c: &mut Call, name: &str) -> Option<Action> {
    let fd = c.arg(0) as i32;
    match name {
        "lwip_socket" => {
            let (domain, kind) = (c.arg(0), c.arg(1) & 0xff);
            if domain != AF_INET {
                return Some(c.fail(EAFNOSUPPORT, u32::MAX));
            }
            if kind != SOCK_STREAM {
                return Some(c.fail(EPROTONOSUPPORT, u32::MAX));
            }
            let net = &mut c.soc.net;
            let Some(fd) = (FD_BASE..FD_END).find(|f| !net.socks.contains_key(f)) else {
                return Some(c.fail(ENFILE, u32::MAX));
            };
            let sock = Sock {
                conn: 0,
                nonblock: false,
                state: State::Fresh,
                rx: VecDeque::new(),
                error: 0,
                remote: ([0; 4], 0),
                rcv_timeout_us: 0,
            };
            net.socks.insert(fd, sock);
            done(c, fd as u32)
        }
        "lwip_getaddrinfo" => getaddrinfo(c),
        "lwip_select" => select(c),
        "lwip_freeaddrinfo" => {
            let ai = c.arg(0);
            if (SCRATCH_BASE..SCRATCH_BASE + SCRATCH_SIZE).contains(&ai) {
                Some(Action::Return)
            } else {
                Some(Action::Pass)
            }
        }
        _ => {
            if !c.soc.net.socks.contains_key(&fd) {
                return Some(c.fail(EBADF, u32::MAX));
            }
            sock_call(c, name, fd)
        }
    }
}

fn sock_call(c: &mut Call, name: &str, fd: i32) -> Option<Action> {
    let a = [c.arg(0), c.arg(1), c.arg(2), c.arg(3), c.arg(4), c.arg(5)];
    macro_rules! sock {
        () => {
            c.soc.net.socks.get_mut(&fd).unwrap()
        };
    }
    let (state, nonblock) = (sock!().state, sock!().nonblock);
    match name {
        "lwip_close" => {
            let s = c.soc.net.socks.remove(&fd).unwrap();
            if matches!(s.state, State::Connecting | State::Connected | State::PeerClosed | State::Eof) {
                c.soc.net.ops.push(NetOp::Close { conn: s.conn });
            }
            done(c, 0)
        }
        "lwip_connect" => {
            let sa = c.read_bytes(a[1], 8);
            if sa[1] as u32 != AF_INET {
                return Some(c.fail(EAFNOSUPPORT, u32::MAX));
            }
            let port = u16::from_be_bytes([sa[2], sa[3]]);
            let ip = [sa[4], sa[5], sa[6], sa[7]];
            // No route to "any" or broadcast (a failed DNS lookup leaves 0.0.0.0)
            if state == State::Fresh && (ip == [0; 4] || ip == [255; 4]) {
                return Some(c.fail(EHOSTUNREACH, u32::MAX));
            }
            match state {
                State::Fresh => {
                    let net = &mut c.soc.net;
                    let conn = net.next_conn;
                    net.next_conn += 1;
                    net.ops.push(NetOp::Connect { conn, ip, port });
                    let s = sock!();
                    s.conn = conn;
                    s.state = State::Connecting;
                    s.remote = (ip, port);
                    if nonblock {
                        Some(c.fail(EINPROGRESS, u32::MAX))
                    } else {
                        Some(Action::Retry)
                    }
                }
                State::Connecting if nonblock => Some(c.fail(EALREADY, u32::MAX)),
                State::Connecting => Some(Action::Retry),
                State::Connected | State::PeerClosed | State::Eof if nonblock => Some(c.fail(EISCONN, u32::MAX)),
                State::Connected | State::PeerClosed | State::Eof => done(c, 0),
                State::Failed => {
                    let e = std::mem::take(&mut sock!().error);
                    Some(c.fail(if e == 0 { ECONNREFUSED } else { e }, u32::MAX))
                }
                State::Listening => Some(c.fail(EISCONN, u32::MAX)),
            }
        }
        "lwip_send" | "lwip_sendto" | "lwip_write" => {
            let (data, size) = (a[1], a[2]);
            let flags = if name == "lwip_write" { 0 } else { a[3] };
            match state {
                State::Connected | State::PeerClosed => {
                    let conn = sock!().conn;
                    let bytes = c.read_bytes(data, size);
                    let net = &mut c.soc.net;
                    net.tx_bytes += size as u64;
                    if size > 0 {
                        net.ops.push(NetOp::Send { conn, data: bytes });
                    }
                    done(c, size)
                }
                State::Connecting if nonblock || flags & MSG_DONTWAIT != 0 => Some(c.fail(EAGAIN, u32::MAX)),
                State::Connecting => Some(Action::Retry),
                State::Failed => {
                    let e = std::mem::take(&mut sock!().error);
                    Some(c.fail(if e == 0 { ECONNRESET } else { e }, u32::MAX))
                }
                State::Fresh | State::Listening | State::Eof => Some(c.fail(ENOTCONN, u32::MAX)),
            }
        }
        "lwip_recv" | "lwip_recvfrom" | "lwip_read" => {
            let (mem, len) = (a[1], a[2]);
            let flags = if name == "lwip_read" { 0 } else { a[3] };
            let s = sock!();
            if !s.rx.is_empty() {
                let n = (len as usize).min(s.rx.len());
                let bytes: Vec<u8> = if flags & MSG_PEEK != 0 { s.rx.iter().take(n).copied().collect() } else { s.rx.drain(..n).collect() };
                let remote = s.remote;
                end_wait(c);
                c.write_bytes(mem, &bytes);
                if name == "lwip_recvfrom" && a[4] != 0 && a[5] != 0 {
                    c.write_bytes(a[4], &sockaddr_in(remote.0, remote.1));
                    c.w32(a[5], 16);
                }
                return done(c, n as u32);
            }
            match state {
                State::PeerClosed => {
                    sock!().state = State::Eof;
                    end_wait(c);
                    done(c, 0)
                }
                State::Failed => {
                    let s = sock!();
                    let e = std::mem::take(&mut s.error);
                    s.state = State::PeerClosed;
                    end_wait(c);
                    Some(c.fail(if e == 0 { ECONNRESET } else { e }, u32::MAX))
                }
                State::Fresh | State::Listening | State::Eof => {
                    end_wait(c);
                    Some(c.fail(ENOTCONN, u32::MAX))
                }
                State::Connecting | State::Connected if nonblock || flags & MSG_DONTWAIT != 0 => Some(c.fail(EAGAIN, u32::MAX)),
                State::Connecting | State::Connected => {
                    let us = sock!().rcv_timeout_us;
                    if timed_out(c, (us > 0).then_some(us)) {
                        Some(c.fail(EAGAIN, u32::MAX))
                    } else {
                        Some(Action::Retry)
                    }
                }
            }
        }
        "lwip_fcntl" => match a[1] {
            F_GETFL => done(c, O_RDWR | if nonblock { O_NONBLOCK } else { 0 }),
            F_SETFL => {
                sock!().nonblock = a[2] & O_NONBLOCK != 0;
                done(c, 0)
            }
            _ => Some(c.fail(ENOSYS, u32::MAX)),
        },
        "lwip_ioctl" => match a[1] {
            FIONREAD => {
                let n = sock!().rx.len() as u32;
                c.w32(a[2], n);
                done(c, 0)
            }
            FIONBIO => {
                let on = c.r32(a[2]) != 0;
                sock!().nonblock = on;
                done(c, 0)
            }
            _ => Some(c.fail(EINVAL, u32::MAX)),
        },
        "lwip_setsockopt" => {
            let (level, opt, val) = (a[1], a[2], a[3]);
            if level == SOL_SOCKET && opt == SO_RCVTIMEO {
                let sec = c.r32(val) as u64 | ((c.r32(val + 4) as u64) << 32);
                let usec = c.r32(val + 8) as u64;
                sock!().rcv_timeout_us = sec * 1_000_000 + usec;
            }
            done(c, 0)
        }
        "lwip_getsockopt" => {
            let (level, opt, val, len) = (a[1], a[2], a[3], a[4]);
            let v = match (level, opt) {
                (SOL_SOCKET, SO_ERROR) => {
                    let s = sock!();
                    let e = std::mem::take(&mut s.error);
                    if s.state == State::Failed && e != 0 {
                        // Reported once; afterwards the socket reads as closed
                        s.state = State::PeerClosed;
                    }
                    e
                }
                (SOL_SOCKET, SO_TYPE) => SOCK_STREAM,
                _ => 0,
            };
            c.w32(val, v);
            if len != 0 {
                c.w32(len, 4);
            }
            done(c, 0)
        }
        "lwip_getpeername" | "lwip_getsockname" => {
            let remote = sock!().remote;
            let sa = if name == "lwip_getpeername" { sockaddr_in(remote.0, remote.1) } else { sockaddr_in(STA_IP, 49152 + fd as u16) };
            c.write_bytes(a[1], &sa);
            c.w32(a[2], 16);
            done(c, 0)
        }
        "lwip_shutdown" | "lwip_bind" => done(c, 0),
        "lwip_listen" => {
            sock!().state = State::Listening;
            done(c, 0)
        }
        // Nobody can reach the virtual network from outside: no client ever arrives
        "lwip_accept" if nonblock => Some(c.fail(EAGAIN, u32::MAX)),
        "lwip_accept" => Some(Action::Retry),
        "lwip_select" => select(c),
        _ => None,
    }
}

fn select(c: &mut Call) -> Option<Action> {
    let (nfds, sets, tv) = (c.arg(0) as i32, [c.arg(1), c.arg(2), c.arg(3)], c.arg(4));
    let mut out = [0u64; 3];
    let mut ready = 0;
    for (k, &set) in sets.iter().enumerate() {
        if set == 0 {
            continue;
        }
        let bits = c.r32(set) as u64 | ((c.r32(set + 4) as u64) << 32);
        for fd in FD_BASE..nfds.min(FD_END) {
            if bits >> fd & 1 == 0 {
                continue;
            }
            let Some(s) = c.soc.net.socks.get(&fd) else { continue };
            let hit = match k {
                0 => !s.rx.is_empty() || matches!(s.state, State::PeerClosed | State::Eof | State::Failed),
                1 => matches!(s.state, State::Connected | State::PeerClosed | State::Eof | State::Failed),
                _ => false,
            };
            if hit {
                out[k] |= 1 << fd;
                ready += 1;
            }
        }
    }
    let timeout_us = (tv != 0).then(|| {
        let sec = c.r32(tv) as u64 | ((c.r32(tv + 4) as u64) << 32);
        sec * 1_000_000 + c.r32(tv + 8) as u64
    });
    if ready == 0 && timeout_us != Some(0) && !timed_out(c, timeout_us) {
        return Some(Action::Retry);
    }
    end_wait(c);
    for (k, &set) in sets.iter().enumerate() {
        if set != 0 {
            c.w32(set, out[k] as u32);
            c.w32(set + 4, (out[k] >> 32) as u32);
        }
    }
    done(c, ready)
}

fn getaddrinfo(c: &mut Call) -> Option<Action> {
    let (node, service, hints, res) = (c.arg(0), c.arg(1), c.arg(2), c.arg(3));
    if node == 0 || res == 0 {
        return done(c, EAI_FAIL);
    }
    let name = String::from_utf8_lossy(&c.cstr(node)).into_owned();
    let (family, socktype, protocol) = if hints != 0 { (c.r32(hints + 4), c.r32(hints + 8), c.r32(hints + 12)) } else { (0, 0, 0) };
    if family != 0 && family != AF_INET {
        return done(c, EAI_FAMILY);
    }
    let port: u16 = if service != 0 { String::from_utf8_lossy(&c.cstr(service)).parse().unwrap_or(0) } else { 0 };
    let now = c.soc.cycles;
    let ip = match parse_ipv4(&name) {
        Some(ip) => ip,
        None => {
            let net = &mut c.soc.net;
            match net.dns.get(&name) {
                Some(Dns::Found(ip)) => *ip,
                Some(Dns::Failed) => {
                    net.dns.remove(&name);
                    return done(c, EAI_FAIL);
                }
                Some(Dns::Pending(deadline)) if now >= *deadline => {
                    net.dns.remove(&name);
                    return done(c, EAI_FAIL);
                }
                Some(Dns::Pending(_)) => return Some(Action::Retry),
                None => {
                    net.dns.insert(name.clone(), Dns::Pending(now + DNS_TIMEOUT));
                    net.ops.push(NetOp::Resolve { name });
                    return Some(Action::Retry);
                }
            }
        }
    };
    // addrinfo + sockaddr_in in scratch RAM; lwip_freeaddrinfo leaves it there
    let net = &mut c.soc.net;
    let slot = SLOT_ADDRINFO + (net.addrinfo_next % ADDRINFO_SLOTS) * ADDRINFO_SIZE;
    net.addrinfo_next += 1;
    let mut ai = [0u8; 32];
    ai[4..8].copy_from_slice(&AF_INET.to_le_bytes());
    ai[8..12].copy_from_slice(&(if socktype == 0 { SOCK_STREAM } else { socktype }).to_le_bytes());
    ai[12..16].copy_from_slice(&protocol.to_le_bytes());
    ai[16..20].copy_from_slice(&16u32.to_le_bytes());
    ai[20..24].copy_from_slice(&(slot + 32).to_le_bytes());
    c.write_bytes(slot, &ai);
    c.write_bytes(slot + 32, &sockaddr_in(ip, port));
    c.w32(res, slot);
    done(c, 0)
}
