// SPDX-License-Identifier: GPL-3.0-only
// The original head stays on its registered raster. The flat-cut costume and
// limbs are authored below in the same 1254 × 1254 coordinate space.
const size = 1254;
const inks = {
  edge: '#05060e',
  coat: '#171825',
  shade: '#242339',
  violet: '#751ef3',
  scarlet: '#ff1247',
  redShade: '#b30036',
  green: '#00e957',
  greenShade: '#006934',
};

const headClip = [
  [0, 0],
  [1254, 0],
  [1254, 664],
  [780, 664],
  [780, 558],
  [747, 516],
  [713, 507],
  [704, 445],
  [672, 450],
  [650, 469],
  [578, 455],
  [559, 477],
  [526, 495],
  [519, 545],
  [0, 545],
];
function shape(part, fill, points, options) {
  return {
    part,
    fill: inks[fill],
    points: points.split(' ').map((point) => point.split(',').map(Number)),
    ...options,
  };
}
const behindHead = { behindHead: true };
const sideRightShin = { swing: [471, 841, 1], behindHead: true };
const sideLeftShin = { swing: [681, 878, -1], behindHead: true };
const ceilingRightShin = { swing: [565, 937, 1], behindHead: true };
const ceilingLeftShin = { swing: [696, 954, -1], behindHead: true };

const side = [
  // The high hand holds the edge. The other hand reaches across the waist to brace.
  shape(
    'right-arm',
    'edge',
    '533,541 457,533 330,467 246,415 216,425 244,478 314,533 490,597',
    behindHead,
  ),
  shape('right-arm', 'violet', '481,553 332,491 244,439 315,528 483,581', behindHead),
  shape('right-arm', 'greenShade', '324,487 253,432 224,426 245,458 305,509', behindHead),
  shape('right-arm', 'green', '269,465 226,426 238,453 269,480', behindHead),
  shape(
    'right-hand',
    'edge',
    '243,441 216,433 206,452 189,454 190,446 202,433 192,421 171,421 171,407 199,406 211,417 203,398 178,395 174,382 205,382 224,413 244,420',
  ),
  shape('right-hand', 'green', '227,416 202,413 175,410 175,419 204,423 222,435'),
  shape('right-hand', 'greenShade', '202,399 179,394 176,384 204,385 219,411'),
  shape(
    'left-leg',
    'edge',
    '605,729 673,724 721,804 697,883 657,918 636,889 659,813 604,776',
    behindHead,
  ),
  shape(
    'left-leg',
    'scarlet',
    '647,739 682,756 710,806 676,877 652,892 675,813 631,774',
    behindHead,
  ),
  shape('left-leg', 'redShade', '656,763 703,803 682,837 674,816', behindHead),
  shape(
    'right-leg',
    'edge',
    '533,706 608,746 596,793 497,863 455,870 429,843 478,795 514,752',
    behindHead,
  ),
  shape('right-leg', 'scarlet', '541,736 584,761 547,805 470,850 454,842 501,799', behindHead),
  shape('right-leg', 'redShade', '551,791 503,832 463,848 476,830 518,800', behindHead),
  shape(
    'right-leg',
    'edge',
    '439,825 487,825 511,852 480,935 438,988 414,980 438,921 417,880',
    sideRightShin,
  ),
  shape('right-leg', 'scarlet', '444,838 485,838 472,897 433,958 450,910 427,868', sideRightShin),
  shape('right-leg', 'redShade', '429,866 450,905 430,954 430,926 417,905', sideRightShin),
  shape('right-foot', 'edge', '442,951 433,992 393,1030 318,1055 366,997 416,967', sideRightShin),
  shape('right-foot', 'scarlet', '439,959 417,999 326,1049 388,999 414,976', sideRightShin),
  shape(
    'left-leg',
    'edge',
    '661,856 707,851 730,911 768,994 753,1039 711,1020 676,957 647,903',
    sideLeftShin,
  ),
  shape(
    'left-leg',
    'scarlet',
    '669,863 706,876 708,929 749,1019 710,996 697,950 660,911',
    sideLeftShin,
  ),
  shape('left-leg', 'redShade', '728,953 753,1002 745,1024 731,991', sideLeftShin),
  shape('left-foot', 'edge', '725,986 765,991 788,1041 858,1091 784,1083 740,1040', sideLeftShin),
  shape('left-foot', 'scarlet', '742,1001 782,1059 849,1087 790,1077 759,1051', sideLeftShin),
  shape(
    'torso',
    'edge',
    '597,453 638,464 603,537 621,602 596,667 647,752 600,786 533,760 493,700 464,640 484,579 453,544 472,513 548,526',
  ),
  shape('torso', 'greenShade', '601,469 632,472 591,561 556,573 563,528'),
  shape('torso', 'coat', '476,520 549,539 510,570 503,623 555,714 508,699 478,647 501,589 466,549'),
  shape('torso', 'violet', '476,520 549,539 507,575 495,623 548,709 484,652 490,603 464,546'),
  shape('torso', 'coat', '480,528 540,541 505,570 490,623 534,690 488,646 496,602 473,545'),
  shape('torso', 'shade', '586,542 616,580 605,633 616,675 659,737 620,730 587,689 579,625'),
  shape('chest', 'scarlet', '574,551 595,570 570,616 579,628 541,653 553,622 536,609 557,600'),
  shape('chest', 'green', '563,539 573,565 540,615 525,584 537,552'),
  shape('pelvis', 'redShade', '529,676 581,675 622,717 621,750 581,779 542,748 530,725'),
  shape('pelvis', 'scarlet', '535,678 578,687 611,730 577,715 576,752 550,726'),
  shape(
    'left-arm',
    'edge',
    '606,568 635,587 649,641 555,703 444,659 394,615 417,595 479,626 548,644 595,605',
  ),
  shape('left-arm', 'violet', '619,581 636,603 640,637 555,690 445,656 418,622 551,669 614,622'),
  shape('left-arm', 'coat', '615,586 634,611 633,637 548,684 446,651 430,630 555,669 622,619'),
  shape('left-arm', 'green', '479,630 452,651 408,621 416,602 431,610'),
  shape(
    'left-hand',
    'edge',
    '423,603 421,625 395,624 371,607 355,610 354,599 368,591 349,581 353,569 375,576 376,564 388,560 405,587',
  ),
  shape('left-hand', 'green', '418,609 395,606 373,583 383,584 384,574 399,593'),
];

const ceiling = [
  // Both sets of fingers meet the ledge line. The elbows angle away from the hair.
  shape(
    'right-arm',
    'edge',
    '529,552 485,525 422,420 396,354 407,249 426,170 457,168 454,274 463,337 544,472 569,528',
    behindHead,
  ),
  shape(
    'right-arm',
    'violet',
    '427,173 436,219 418,349 454,435 541,529 515,524 443,433 403,351',
    behindHead,
  ),
  shape('right-arm', 'green', '421,176 444,176 435,267 420,306 413,268', behindHead),
  shape('right-arm', 'shade', '457,353 522,460 541,505 504,474 460,412', behindHead),
  shape(
    'left-arm',
    'edge',
    '698,545 722,472 786,367 805,306 793,222 798,175 829,166 841,255 853,331 819,424 748,547',
    behindHead,
  ),
  shape(
    'left-arm',
    'violet',
    '826,175 845,255 846,330 812,416 748,537 725,536 810,395 829,321',
    behindHead,
  ),
  shape('left-arm', 'green', '798,178 823,176 833,259 823,288 803,230', behindHead),
  shape('left-arm', 'shade', '814,348 816,378 780,456 738,507 760,449', behindHead),
  shape(
    'right-hand',
    'edge',
    '425,200 409,164 409,140 424,136 431,150 435,125 451,124 459,147 468,134 479,138 478,163 459,184 451,201',
  ),
  shape(
    'right-hand',
    'green',
    '422,149 435,164 442,137 453,132 454,159 467,150 464,170 441,190 432,177',
  ),
  shape('right-hand', 'greenShade', '429,159 437,169 449,164 449,183 437,188'),
  shape(
    'left-hand',
    'edge',
    '799,199 787,164 780,142 791,135 805,148 807,125 822,124 832,151 838,136 851,140 849,166 827,184 825,201',
  ),
  shape(
    'left-hand',
    'green',
    '792,145 808,158 813,132 823,135 825,164 841,148 840,164 822,190 806,178',
  ),
  shape('left-hand', 'greenShade', '807,163 822,168 833,163 825,183 815,185'),
  shape(
    'right-leg',
    'edge',
    '550,768 605,776 639,824 609,878 591,945 556,974 536,942 529,881 537,828',
    behindHead,
  ),
  shape(
    'right-leg',
    'scarlet',
    '552,799 601,797 590,850 568,878 568,943 544,920 540,874',
    behindHead,
  ),
  shape('right-leg', 'redShade', '571,849 591,829 592,854 573,892 570,915 564,892', behindHead),
  shape(
    'left-leg',
    'edge',
    '642,774 705,786 717,841 701,902 717,943 692,977 666,961 646,896 662,850 623,815',
    behindHead,
  ),
  shape(
    'left-leg',
    'scarlet',
    '673,803 704,800 705,848 679,899 700,951 672,946 661,902 671,845',
    behindHead,
  ),
  shape('left-leg', 'redShade', '678,873 705,843 695,873 688,906 706,948 690,940', behindHead),
  shape(
    'right-leg',
    'edge',
    '537,928 580,920 597,948 568,999 560,1072 536,1090 516,1062 517,1011',
    ceilingRightShin,
  ),
  shape(
    'right-leg',
    'scarlet',
    '543,933 576,928 568,965 544,994 543,1060 527,1039 531,995',
    ceilingRightShin,
  ),
  shape(
    'right-leg',
    'redShade',
    '546,980 557,971 551,1015 555,1037 542,1056 537,1027',
    ceilingRightShin,
  ),
  shape(
    'right-foot',
    'edge',
    '525,1042 560,1056 557,1098 520,1164 506,1125 512,1081',
    ceilingRightShin,
  ),
  shape('right-foot', 'scarlet', '535,1052 545,1071 537,1128 520,1159 520,1113', ceilingRightShin),
  shape(
    'left-leg',
    'edge',
    '671,939 707,933 739,977 749,1040 722,1084 696,1056 682,1003 663,973',
    ceilingLeftShin,
  ),
  shape(
    'left-leg',
    'scarlet',
    '679,943 699,940 728,983 729,1043 721,1060 704,1020 704,986',
    ceilingLeftShin,
  ),
  shape('left-leg', 'redShade', '710,981 727,997 729,1047 722,1056 712,1031', ceilingLeftShin),
  shape(
    'left-foot',
    'edge',
    '711,1048 744,1050 759,1095 807,1142 759,1136 725,1103',
    ceilingLeftShin,
  ),
  shape(
    'left-foot',
    'scarlet',
    '725,1055 742,1073 758,1108 800,1139 760,1127 741,1104',
    ceilingLeftShin,
  ),
  shape(
    'torso',
    'edge',
    '608,526 647,522 677,544 716,537 746,557 718,616 698,676 716,755 690,794 631,820 576,799 537,758 550,679 528,625 509,566 541,543 574,560',
  ),
  shape(
    'torso',
    'violet',
    '513,568 541,546 576,565 556,618 580,655 553,698 538,756 545,680 524,622',
  ),
  shape('torso', 'coat', '522,568 541,553 565,566 548,618 571,656 550,688 553,667 531,622'),
  shape(
    'torso',
    'violet',
    '686,551 714,540 741,558 714,617 696,670 713,749 693,709 675,675 688,626 679,595',
  ),
  shape(
    'torso',
    'shade',
    '688,558 715,547 734,559 706,621 692,666 703,720 681,676 693,625 686,593',
  ),
  shape('torso', 'greenShade', '606,531 647,524 652,562 611,589 589,570'),
  shape('chest', 'green', '607,552 627,568 610,601 619,619 589,655 581,621 581,581'),
  shape(
    'chest',
    'scarlet',
    '649,551 684,583 656,616 663,633 633,655 632,680 602,692 613,649 638,623 625,600 651,579',
  ),
  shape('torso', 'green', '584,678 619,666 608,700 574,702'),
  shape(
    'pelvis',
    'scarlet',
    '563,722 597,726 631,708 677,716 696,750 665,771 637,760 638,802 610,773 574,763',
  ),
  shape('pelvis', 'redShade', '602,754 628,770 638,802 605,787 578,770'),
];

const sidePose = {
  anchor: { x: 171, y: 413 },
  visibleBounds: { x: 171, y: 132, width: 874, height: 980 },
  head: { clip: headClip, scale: 0.93, x: 34, y: 32 },
  layers: side,
};
const ceilingPose = {
  anchor: { x: 627, y: 125 },
  visibleBounds: { x: 280, y: 124, width: 710, height: 1050 },
  head: { clip: headClip, scale: 0.8, x: 123, y: 162 },
  layers: ceiling,
};
const poses = new Map([
  ['dock-left', { ...sidePose, mirror: false }],
  [
    'dock-right',
    {
      ...sidePose,
      mirror: true,
      anchor: { x: size - sidePose.anchor.x, y: sidePose.anchor.y },
      visibleBounds: {
        ...sidePose.visibleBounds,
        x: size - sidePose.visibleBounds.x - sidePose.visibleBounds.width,
      },
    },
  ],
  ['ceiling', { ...ceilingPose, mirror: false }],
]);

export function avatarGripPose(dock) {
  return poses.get(dock) ?? null;
}

export function avatarGripSwing(time, dock) {
  const phase = (Math.floor(time / (1000 / 12)) % 36) / 36;
  return Math.sin(phase * Math.PI * 2) * (dock === 'ceiling' ? 3.1 : 2.4);
}
