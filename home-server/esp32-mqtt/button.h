// The BOOT button: a press toggles the LED by hand
#pragma once

void buttonBegin();
void updateButton(unsigned long now);  // debounced, never blocks
