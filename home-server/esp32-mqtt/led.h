// The onboard LED: the switch Home Assistant controls, its state kept in flash
#pragma once

void ledBegin();         // the pin, and the state from before the restart
void applyLed(bool on);  // switch it and remember it (Home Assistant's command: LabHA reports it)
void setLed(bool on);    // switch it by hand: applyLed + report it to Home Assistant
bool ledIsOn();
