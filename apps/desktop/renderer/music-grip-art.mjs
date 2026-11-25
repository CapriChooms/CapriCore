// SPDX-License-Identifier: GPL-3.0-only
// Registered on the 1254 px originals. Each row or column contains the two
// sides of the arm. Keep the crossings with face spikes and jacket lapels tight.
export const gripArt = {
  'pose-ceiling': {
    face: [
      [559, 354],
      [594, 337],
      [615, 369],
      [634, 337],
      [678, 315],
      [685, 380],
      [676, 393],
      [641, 438],
      [627, 449],
      [619, 451],
      [577, 432],
      [568, 415],
      [553, 385],
    ],
    axis: 1,
    pivot: [619, 119],
    arms: [
      {
        wrist: [492, 144],
        elbow: [515, 295],
        shoulder: [580, 480],
        bands: [
          [68, 428, 540],
          [112, 428, 540],
          [125, 433, 528],
          [144, 473, 511],
          [228, 480, 521],
          [281, 493, 527],
          [330, 509, 535],
          [370, 521, 548],
          [406, 534, 560],
          [435, 546, 571],
          [464, 558, 585],
          [472, 561, 584],
          [482, 568, 582],
          [491, 572, 580],
        ],
      },
      {
        wrist: [759, 144],
        elbow: [737, 293],
        shoulder: [669, 485],
        bands: [
          [68, 711, 823],
          [121, 712, 823],
          [143, 742, 782],
          [181, 740, 774],
          [192, 738, 771],
          [225, 734, 770],
          [276, 726, 758],
          [314, 721, 746],
          [337, 717, 738],
          [357, 710, 732],
          [379, 703, 725],
          [405, 692, 718],
          [435, 681, 706],
          [464, 670, 694],
          [475, 663, 689],
          [487, 658, 683],
          [495, 662, 678],
        ],
      },
    ],
  },
  'pose-dock-left': {
    face: [
      [522, 310],
      [674, 310],
      [674, 436],
      [522, 436],
    ],
    axis: 0,
    pivot: [531, 543],
    arms: [
      {
        wrist: [270, 490],
        elbow: [409, 516],
        shoulder: [522, 498],
        bands: [
          [215, 432, 514],
          [265, 432, 514],
          [273, 473, 512],
          [369, 490, 524],
          [410, 498, 531],
          [492, 488, 521],
          [520, 481, 515],
          [524, 486, 511],
        ],
      },
      {
        wrist: [271, 658],
        elbow: [398, 611],
        shoulder: [529, 585],
        bands: [
          [214, 609, 695],
          [269, 609, 695],
          [275, 635, 680],
          [400, 593, 635],
          [498, 574, 608],
          [525, 570, 594],
          [535, 569, 580],
        ],
      },
    ],
  },
  'pose-dock-right': {
    face: [
      [501, 270],
      [651, 270],
      [651, 405],
      [501, 405],
    ],
    axis: 0,
    pivot: [678, 525],
    arms: [
      {
        wrist: [987, 436],
        elbow: [796, 469],
        shoulder: [661, 455],
        bands: [
          [650, 440, 451],
          [660, 441, 460],
          [677, 444, 470],
          [695, 446, 482],
          [786, 450, 485],
          [825, 448, 484],
          [910, 430, 471],
          [981, 418, 457],
          [988, 392, 452],
          [992, 371, 457],
          [1047, 370, 461],
        ],
      },
      {
        wrist: [976, 620],
        elbow: [833, 590],
        shoulder: [705, 540],
        bands: [
          [696, 524, 541],
          [711, 525, 556],
          [760, 545, 583],
          [834, 575, 611],
          [971, 598, 640],
          [982, 562, 649],
          [1038, 560, 648],
        ],
      },
    ],
  },
};

export function armOutline(axis, bands) {
  const point = (along, across) => (axis ? [across, along] : [along, across]);
  return [
    ...bands.map(([s, low]) => point(s, low)),
    ...bands
      .slice()
      .reverse()
      .map(([s, , high]) => point(s, high)),
  ];
}

// The upper square is the complete clean back plate. Below it are the two arms.
export function armRegions(profile) {
  let row = 1254;
  return profile.arms.map((arm) => {
    const outline = armOutline(profile.axis, arm.bands);
    const xs = outline.map((p) => p[0]),
      ys = outline.map((p) => p[1]);
    const x = Math.min(...xs) - 2,
      y = Math.min(...ys) - 2;
    const w = Math.max(...xs) + 3 - x,
      h = Math.max(...ys) + 3 - y;
    const region = { ...arm, outline, x, y, w, h, row };
    row += h;
    return region;
  });
}
