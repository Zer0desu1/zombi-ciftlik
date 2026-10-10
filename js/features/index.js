import { registerFeatures } from './registry.js';
import mobile from './mobile.js';
import farming from './farming.js';
import animals from './animals.js';
import combat from './combat.js';
import zombies from './zombies.js';
import defense from './defense.js';
import town from './town.js';
import progression from './progression.js';
import world from './world.js';
import juice from './juice.js';
import director from './director.js';
import harvest from './harvest.js';

registerFeatures([mobile, world, farming, animals, combat, zombies, defense, town, progression, juice, harvest, director]);
export { features } from './registry.js';
