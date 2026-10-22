//! The city-wide roof palette, ported from `src/lib/diorama/roof-palette.ts` (`roofCentres`):
//! deterministic k-means over the houses' sampled roof colours, seeded from evenly spaced
//! houses. Each round accumulates every tone's sum in one pass over the colours, in the same
//! order the TypeScript `filter` + `reduce` adds them, so the float means agree exactly.

const ROOF_TONES: usize = 6;
const KMEANS_ROUNDS: usize = 12;

type Rgb = [f64; 3];

fn distance2(a: Rgb, b: Rgb) -> f64 {
    (0..3)
        .map(|c| (a[c] - b[c]) * (a[c] - b[c]))
        .fold(0.0, |sum, part| sum + part)
}

/// The first centre at the smallest distance.
fn nearest(colour: Rgb, centres: &[Rgb]) -> usize {
    let mut best = 0;
    for (index, &centre) in centres.iter().enumerate() {
        if distance2(colour, centre) < distance2(colour, centres[best]) {
            best = index;
        }
    }
    best
}

/// Every tone's mean colour. A tone with no members keeps its centre.
fn means(colours: &[Rgb], labels: &[usize], centres: &[Rgb]) -> Vec<Rgb> {
    let mut sums = vec![[0.0; 3]; centres.len()];
    let mut counts = vec![0usize; centres.len()];
    for (colour, &tone) in colours.iter().zip(labels) {
        (0..3).for_each(|c| sums[tone][c] += colour[c]);
        counts[tone] += 1;
    }
    centres
        .iter()
        .zip(sums.iter().zip(&counts))
        .map(|(&centre, (sum, &count))| {
            if count == 0 {
                centre
            } else {
                sum.map(|total| total / count as f64)
            }
        })
        .collect()
}

/// Tone centres, rounded to whole channel values. O(colours · tones · rounds).
pub fn roof_centres(roofs: &[[u8; 3]]) -> Vec<[u8; 3]> {
    let colours: Vec<Rgb> = roofs.iter().map(|rgb| rgb.map(f64::from)).collect();
    let count = ROOF_TONES.min(colours.len());
    let mut centres: Vec<Rgb> = (0..count)
        .map(|i| colours[i * colours.len() / count])
        .collect();
    let mut labels: Vec<usize> = colours.iter().map(|&c| nearest(c, &centres)).collect();
    for _ in 0..KMEANS_ROUNDS {
        centres = means(&colours, &labels, &centres);
        labels = colours.iter().map(|&c| nearest(c, &centres)).collect();
    }
    centres
        .iter()
        .map(|centre| centre.map(|channel| crate::js::round(channel) as u8))
        .collect()
}
