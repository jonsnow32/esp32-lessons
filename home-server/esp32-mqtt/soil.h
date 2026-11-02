// Capacitive soil moisture sensor: read every SENSOR_INTERVAL, printed and sent to Home Assistant
#pragma once

void soilBegin();
void updateSoil(unsigned long now);
