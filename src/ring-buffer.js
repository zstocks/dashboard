// ring-buffer.js — Fixed-size circular buffer
//
// A ring buffer is an array that wraps around when it reaches capacity.
// When full, the oldest entry is overwritten by the newest.
//
// Why use this instead of a plain array?
// If you push to a regular array every 5 seconds, after a day you'd have
// 17,280 entries and growing. A ring buffer caps memory usage — you decide
// upfront how much history to keep, and it never grows beyond that.
//
// How it works:
//
//   Capacity: 5
//
//   After 3 writes:     [A] [B] [C] [ ] [ ]
//                                     ^ next write position
//
//   After 5 writes:     [A] [B] [C] [D] [E]    ← full
//                        ^ next write wraps here
//
//   After 6 writes:     [F] [B] [C] [D] [E]    ← A is gone
//                            ^ next write position
//
//   toArray() returns:  [B, C, D, E, F]         ← oldest to newest

class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;     // Next write position
    this.size = 0;     // How many entries are stored (up to capacity)
  }

  // Add an item to the buffer
  push(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  // Get the most recent item
  latest() {
    if (this.size === 0) return null;
    // head points to the NEXT write position, so the most recent
    // item is one step behind it
    const index = (this.head - 1 + this.capacity) % this.capacity;
    return this.buffer[index];
  }

  // Return all items as an array, oldest to newest
  toArray() {
    if (this.size === 0) return [];

    const result = [];
    // Start from the oldest entry
    // If buffer isn't full yet, oldest is at index 0
    // If buffer is full, oldest is at head (because head is about
    // to overwrite the oldest)
    const start = this.size < this.capacity ? 0 : this.head;

    for (let i = 0; i < this.size; i++) {
      const index = (start + i) % this.capacity;
      result.push(this.buffer[index]);
    }

    return result;
  }

  // How many entries are currently stored
  length() {
    return this.size;
  }

  // Clear all entries
  clear() {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.size = 0;
  }
}

module.exports = RingBuffer;
