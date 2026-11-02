// MQTT to the broker on the home server, and Home Assistant discovery: the LED appears as a
// switch and the soil sensor as a sensor without any setup in Home Assistant
#pragma once

void haBegin();                  // broker, callback, buffer, keepalive (after wifiBegin)
void haLoop(unsigned long now);  // (re)connect without blocking, handle incoming messages
void haPublishLed(bool on);      // the LED state, retained
void haPublishSoil(float moisture, int raw);
