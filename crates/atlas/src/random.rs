//! Seeded pseudo-random numbers, mulberry32, as `tools/assets/src/random.ts` computes them: the
//! same seed gives the same city in both pipelines. `Math.imul`, `>>>` and `^` act on the low 32
//! bits, which wrapping `u32` arithmetic reproduces exactly.

const INCREMENT: u32 = 0x6d2b_79f5;
const UINT32: f64 = 4_294_967_296.0;

pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Mulberry32 { state: seed }
    }

    /// The next float in [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(INCREMENT);
        let state = self.state;
        let mut value = (state ^ (state >> 15)).wrapping_mul(1 | state);
        value = value.wrapping_add((value ^ (value >> 7)).wrapping_mul(61 | value)) ^ value;
        f64::from(value ^ (value >> 14)) / UINT32
    }

    /// A float in [min, max).
    pub fn between(&mut self, [min, max]: [f64; 2]) -> f64 {
        min + self.next_f64() * (max - min)
    }
}
