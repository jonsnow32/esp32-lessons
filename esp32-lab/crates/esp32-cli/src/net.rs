//! The host side of the emulator's virtual network: real TCP connections and DNS lookups for
//! the firmware's sockets (see `esp32_soc::net`). Each connection and lookup runs on its own
//! thread and reports back through a channel, so the emulator never waits on the network.
//!
//! 10.0.2.2 (the virtual gateway) is this machine, as in QEMU: a broker or web server running
//! here is reachable from the firmware at that address.

use esp32_soc::net::{Net, NetOp, ECONNREFUSED, EHOSTUNREACH, ETIMEDOUT, GATEWAY};
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::Duration;

enum Event {
    Connected(u32, TcpStream),
    Failed(u32, u32),
    Data(u32, Vec<u8>),
    Closed(u32),
    Resolved(String, Option<[u8; 4]>),
}

pub struct Bridge {
    tx: Sender<Event>,
    rx: Receiver<Event>,
    streams: HashMap<u32, TcpStream>,
    /// One line per connection and lookup, for the run summary.
    pub log: Vec<String>,
}

fn errno(e: &std::io::Error) -> u32 {
    match e.kind() {
        ErrorKind::ConnectionRefused => ECONNREFUSED,
        ErrorKind::TimedOut | ErrorKind::WouldBlock => ETIMEDOUT,
        _ => EHOSTUNREACH,
    }
}

impl Bridge {
    pub fn new() -> Self {
        let (tx, rx) = channel();
        Self { tx, rx, streams: HashMap::new(), log: vec![] }
    }

    /// Carry out what the firmware asked for and hand it what arrived meanwhile.
    pub fn pump(&mut self, net: &mut Net) {
        for op in net.take_ops() {
            match op {
                NetOp::Connect { conn, ip, port } => {
                    let host = if ip == GATEWAY { Ipv4Addr::LOCALHOST } else { Ipv4Addr::from(ip) };
                    self.log.push(format!("connect {}:{port}{}", Ipv4Addr::from(ip), if ip == GATEWAY { " (this machine)" } else { "" }));
                    let tx = self.tx.clone();
                    std::thread::spawn(move || {
                        let addr = SocketAddr::from((host, port));
                        let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(5)) {
                            Ok(s) => s,
                            Err(e) => {
                                let _ = tx.send(Event::Failed(conn, errno(&e)));
                                return;
                            }
                        };
                        let _ = stream.set_nodelay(true);
                        let Ok(writer) = stream.try_clone() else { return };
                        if tx.send(Event::Connected(conn, writer)).is_err() {
                            return;
                        }
                        let mut buf = [0u8; 4096];
                        loop {
                            match stream.read(&mut buf) {
                                Ok(0) => {
                                    let _ = tx.send(Event::Closed(conn));
                                    return;
                                }
                                Ok(n) => {
                                    if tx.send(Event::Data(conn, buf[..n].to_vec())).is_err() {
                                        return;
                                    }
                                }
                                Err(e) if e.kind() == ErrorKind::Interrupted => {}
                                Err(e) => {
                                    let _ = tx.send(Event::Failed(conn, errno(&e)));
                                    return;
                                }
                            }
                        }
                    });
                }
                NetOp::Send { conn, data } => {
                    if let Some(s) = self.streams.get_mut(&conn) {
                        if s.write_all(&data).is_err() {
                            net.failed(conn, esp32_soc::net::ECONNREFUSED);
                        }
                    }
                }
                NetOp::Close { conn } => {
                    if let Some(s) = self.streams.remove(&conn) {
                        let _ = s.shutdown(Shutdown::Both);
                    }
                }
                NetOp::Resolve { name } => {
                    let tx = self.tx.clone();
                    std::thread::spawn(move || {
                        let ip = (name.as_str(), 0).to_socket_addrs().ok().and_then(|mut a| {
                            a.find_map(|a| match a {
                                SocketAddr::V4(v4) => Some(v4.ip().octets()),
                                _ => None,
                            })
                        });
                        let _ = tx.send(Event::Resolved(name, ip));
                    });
                }
            }
        }
        while let Ok(ev) = self.rx.try_recv() {
            match ev {
                Event::Connected(conn, stream) => {
                    self.streams.insert(conn, stream);
                    net.connected(conn);
                }
                Event::Failed(conn, e) => {
                    self.log.push(format!("connection {conn} failed (errno {e})"));
                    self.streams.remove(&conn);
                    net.failed(conn, e);
                }
                Event::Data(conn, data) => net.received(conn, &data),
                Event::Closed(conn) => {
                    self.streams.remove(&conn);
                    net.closed(conn);
                }
                Event::Resolved(name, ip) => {
                    self.log.push(match ip {
                        Some(ip) => format!("resolve {name} → {}", Ipv4Addr::from(ip)),
                        None => format!("resolve {name} failed"),
                    });
                    net.resolved(&name, ip);
                }
            }
        }
    }
}
