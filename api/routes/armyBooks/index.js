import Router from 'express-promise-router';
import cors from 'cors';
import { nanoid } from 'nanoid';

import { verifyRequest } from '../authProvider';
import * as armyBookService from './army-book-service';
import userAccountService from '../auth/user-account-service';

import units from './units';
import upgradePackages from './upgradePackages';
import specialRules from './specialRules';
import spells from './spells';

const router = new Router();

router.use('/:armyBookUid/units', units);
router.use('/:armyBookUid/upgrade-packages', upgradePackages);
router.use('/:armyBookUid/special-rules', specialRules);
router.use('/:armyBookUid/spells', spells);

router.get('/', cors(), async (request, response) => {

  const { gameSystemSlug } = request.query;

  const items = await armyBookService.getPublicArmyBooksListView(gameSystemSlug);
  response.set('Cache-Control', 'public, max-age=600'); // 5 minutes
  response.status(200).json(items);

});

router.get('/mine', async (request, response) => {
  const armyBooks = await armyBookService.getAllByUserId(request.me.userId);

  response.set('Cache-Control', 'public, max-age=300'); // 5 minutes
  response.status(200).json(armyBooks);
});

router.post('/', async (request, response) => {
  const { name, hint, gameSystemId, background } = request.body;

  const armyBook = await armyBookService.createArmyBook(request.me.userId, gameSystemId, name, hint, background);

  if (armyBook) {
    response.status(200).json(armyBook);
  } else {
    response.status(400).json({message: 'Could not create army book.'});
  }

});

router.post('/detachment', async (request, response) => {
  const { name, hint, gameSystemId, parentArmyBookId, clones, syncs } = request.body;

  // create new army book
  const newArmyBook = await armyBookService.createArmyBook(request.me.userId, gameSystemId, name, hint);
  console.info(`Created new army book -> ${newArmyBook.uid}`);

  // fetch units from parent
  const parentArmyBook = await armyBookService.getArmyBookPublicOrOwner(parentArmyBookId, request.me.userId);
  console.info(`Load parent army book -> ${parentArmyBook.uid}`);

  // set units synced from parent
  const clonedAndSyncedUnits = parentArmyBook.units
    .filter((unit) => clones.includes(unit.id))
    .map((unit) => {
      let sync = undefined;
      if (syncs.includes(unit.id)) {
        sync = {
          parentArmyBookId,
          unitId: unit.id,
          syncAutomatic: true,
        };
      }
      return {
        ...unit,
        id: nanoid(7),
        clone: {
          parentArmyBookId,
          unitId: unit.id,
        },
        sync,
      };
    });

  await armyBookService.setUnits(newArmyBook.uid, request.me.userId, clonedAndSyncedUnits);

  // add upgrade packages
  let clonedUpgradePackages = [];
  clonedAndSyncedUnits.forEach(unit => clonedUpgradePackages.push(...unit.upgrades));
  const uniqueUpgradePackages = [ ...new Set(clonedUpgradePackages)];

  const upgradePackages = parentArmyBook.upgradePackages
    .filter((pck) => uniqueUpgradePackages.includes(pck.uid));
  await armyBookService.setUpgradePackages(newArmyBook.uid, request.me.userId, upgradePackages);

  // add special rules
  // TODO only used special rules
  await armyBookService.setSpecialRules(newArmyBook.uid, request.me.userId, parentArmyBook.specialRules)

  const updatedArmyBook = await armyBookService.getArmyBookPublicOrOwner(newArmyBook.uid, request.me.userId);

  response.status(200).json({...updatedArmyBook});
});

router.post('/import', async (request, response) => {
    const { isOpa, isAdmin }  = await userAccountService.getUserByUuid(request.me.userUuid);

  // only admins are allowed to upload
  if (isAdmin === false) {
    response.status(403).json({message: 'Your account does not allow to import army books.'});
    return;
  }

  let {
    name,
    hint,
    gameSystemId,
    background,
    versionString,
    units,
    upgradePackages,
    spells,
    specialRules,
    official,
    costModeAutomatic,
  } = request.body;

  // make all units match the requested cost mode
  units = units.map(unit => {
    unit.costMode = costModeAutomatic ? 'automatic' : 'manually';
    unit.costModeAutomatic = costModeAutomatic;

    unit.equipment.forEach((gear, index) => {
      gear.name = gear.name || gear.label; // AF use label, but we use name
      //gear.name = pluralize.singular(gear.name); // we singularize any name
      gear.id = nanoid(5);
      if (gear.count && gear.count > 1 && !isNaN(gear.count)) {
        const count = gear.count;
        delete gear.count;
        for (let i = 1; i < count; i++) {
          let duplicate = {
            ...gear,
            id: nanoid(5),
          }
          unit.equipment.push(duplicate);
        }
      }
    });

    unit.equipment.sort((a, b) => {
      if (a.name > b.name) return 1;
      if (a.name < b.name) return -1;
    });

    return unit;
  })

  try {
    const { uid } = await armyBookService.createArmyBook(request.me.userId, gameSystemId, name, hint, background);

    await armyBookService.updateArmyBook(uid, request.me.userId, ['version_string', 'official'], [versionString, official]);

    await armyBookService.setUnits(uid, request.me.userId, units);
    await armyBookService.setSpecialRules(uid, request.me.userId, specialRules);
    await armyBookService.setSpells(uid, request.me.userId, spells);
    await armyBookService.setUpgradePackages(uid, request.me.userId, upgradePackages);

    const armyBook = armyBookService.getArmyBookForOwner(uid, request.me.userId);

    response.status(200).json(armyBook);
  } catch (e) {
    console.error(e);
    response.status(400).json({e});
  }
});

router.get('/:armyBookUid', cors(), async (request, response) => {

  const { armyBookUid } = request.params;
  let userId = request?.me?.userId || 0;

  const armyBook = await armyBookService.getArmyBookPublicOrOwner(armyBookUid, userId);

  if (!armyBook) {
    response.status(404).json({});
  } else {
    // enrich unit missing splitPageNumber
    const units = armyBook.units.map(unit => {
      return {
        ...unit,
        splitPageNumber: parseInt(unit.splitPageNumber) || 1,
      }
    })
    response.set('Cache-Control', 'public, max-age=60'); // 1 minute
    response.status(200).json({...armyBook, units});
  }
});

router.get('/:armyBookUid/mine', async (request, response) => {
  const { armyBookUid } = request.params;

  const armyBook = await armyBookService.getArmyBookForOwner(armyBookUid, request.me.userId);

  if (!armyBook) {
    response.status(404).json({message: 'Not found or no ownership'});
  } else {
    const units = armyBook.units.map(unit => {
      return {
        ...unit,
        splitPageNumber: parseInt(unit.splitPageNumber) || 1,
      };
    });
    response.status(200).json({...armyBook, units});
  }

});

router.get('/:armyBookUid/ownership', async (request, response) => {
  const { armyBookUid } = request.params;

  const { userId } = verifyRequest(request);

  const armyBook = await armyBookService.getSimpleArmyBook(armyBookUid);

  if (!armyBook) {
    response.status(404).json({message: 'Not found.'});
  }

  if (armyBook.userId !== userId) {
    response.status(403).json({message: 'Permission required.'});
  } else {
    response.status(200).json({...armyBook});
  }

});

router.patch('/:armyBookUid', async (request, response) => {
  const { armyBookUid } = request.params;
  const data = request.body

  const patchableColumns = [
    'version_string',
    'name',
    'background',
    'hint',
    'cover_image_path',
    'cover_image_credit',
    'is_live',
    'official',
  ];
  const updateSetFields = [];
  const updateSetValues = [];
  patchableColumns.forEach((column) => {
    if(data[column] !== undefined) {
      updateSetFields.push(`${column} = $${updateSetFields.length+1}`);
      updateSetValues.push(data[column]);
    } else {
      console.info(`No entry found for ${column}`);
    }
  })

  try {
    await armyBookService.updateArmyBook(armyBookUid, request.me.userId, updateSetFields, updateSetValues)
    response.status(204).json();
  } catch (e) {
    console.warn(e)
    response.status(500).json({message: 'Could not update armybook'});
  }

});

router.delete('/:armyBookUid', async (request, response) => {
  const { armyBookUid } = request.params;
  const { userId } = verifyRequest(request);

  await armyBookService.delete(armyBookUid, userId);

  response.status(204).json();
});

export default router;
