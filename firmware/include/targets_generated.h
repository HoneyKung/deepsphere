#pragma once

#include "math/cube_math.h"

namespace GeneratedAssets {

// Generated from assets/source/sea_atlas_luna04_composition.json.
constexpr CubeMath::Target kTargets[] = {
  {"luna04_surface_fish_seam", 0.033203125f, 0.171875f, 0.109375f, 0.16796875f},
  {"luna04_orange_reef_fish", 0.732421875f, 0.1796875f, 0.099609375f, 0.125f},
  {"luna04_manta_ray", 0.333984375f, 0.39453125f, 0.29296875f, 0.30078125f},
  {"luna04_jellyfish", 0.5751953125f, 0.4140625f, 0.169921875f, 0.30078125f},
  {"luna04_lantern_fish", 0.18359375f, 0.828125f, 0.171875f, 0.21875f},
  {"luna04_seahorse_shape", 0.673828125f, 0.8203125f, 0.08984375f, 0.2421875f},
};
constexpr size_t kTargetCount = sizeof(kTargets) / sizeof(kTargets[0]);

}
