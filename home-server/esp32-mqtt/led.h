// The onboard LED: the switch Home Assistant controls, its state kept in flash
#pragma once

void ledBegin();       // the pin, and the state from before the restart
void setLed(bool on);  // switch it, remember it, report it to Home Assistant
bool ledIsOn();
