import fs from "fs";

let code = fs.readFileSync("backend/app/services/mlmService.js", "utf8");
code = code.replace(/\r\n/g, "\n");

// Definition of computeDynamicTreeAllocations function to place at top level or function level:
const funcDefinition = `    const allTreeNodesList = await MlmTree.find({}).lean();
    const allTreeNodesMap = new Map(allTreeNodesList.map((t) => [String(t._id), t]));

    const computeDynamicTreeAllocations = (rootId, totalPool) => {
      const allocations = new Map();
      allocations.set(String(rootId), totalPool);

      const queue = [String(rootId)];
      while (queue.length > 0) {
        const parentId = queue.shift();
        const parent = allTreeNodesMap.get(parentId);
        if (!parent) continue;

        const parentVal = allocations.get(parentId) || 0;
        const leftId = parent.leftId ? String(parent.leftId) : null;
        const rightId = parent.rightId ? String(parent.rightId) : null;

        if (parentId === String(rootId)) {
          if (leftId && rightId) {
            const leftShare = Math.floor(parentVal * (62 / 108));
            const rightShare = Math.max(1, parentVal - leftShare - 1);
            allocations.set(leftId, leftShare);
            allocations.set(rightId, rightShare);
            queue.push(leftId, rightId);
          } else if (leftId) {
            allocations.set(leftId, Math.max(1, parentVal - 1));
            queue.push(leftId);
          } else if (rightId) {
            allocations.set(rightId, Math.max(1, parentVal - 1));
            queue.push(rightId);
          }
        } else if (parent.position === "left" && parent.level === 1) {
          // Left branch level 1 (splits into 30 and 30 IDs)
          if (leftId && rightId) {
            const half = Math.floor(Math.max(2, parentVal - 2) / 2);
            allocations.set(leftId, half);
            allocations.set(rightId, half);
            queue.push(leftId, rightId);
          } else if (leftId) {
            allocations.set(leftId, Math.floor(Math.max(2, parentVal - 2) / 2));
            queue.push(leftId);
          } else if (rightId) {
            allocations.set(rightId, Math.floor(Math.max(2, parentVal - 2) / 2));
            queue.push(rightId);
          }
        } else if (parent.position === "right" && parent.level === 1) {
          // Right branch level 1 (splits into 29 and 14 IDs)
          if (leftId && rightId) {
            const available = Math.max(2, parentVal - 2);
            const leftVal = Math.round(available * (29 / 43));
            const rightVal = Math.max(1, available - leftVal);
            allocations.set(leftId, leftVal);
            allocations.set(rightId, rightVal);
            queue.push(leftId, rightId);
          } else if (leftId) {
            allocations.set(leftId, Math.floor(Math.max(2, parentVal - 2) / 2));
            queue.push(leftId);
          } else if (rightId) {
            allocations.set(rightId, Math.floor(Math.max(2, parentVal - 2) / 2));
            queue.push(rightId);
          }
        } else {
          // Deeper levels (Level 2, 3...)
          if (leftId && rightId) {
            const half = Math.floor(Math.max(2, parentVal - 2) / 2);
            allocations.set(leftId, half);
            allocations.set(rightId, Math.max(1, Math.max(2, parentVal - 2) - half));
            queue.push(leftId, rightId);
          } else if (leftId) {
            allocations.set(leftId, Math.floor(Math.max(2, parentVal - 2) / 2));
            queue.push(leftId);
          } else if (rightId) {
            allocations.set(rightId, Math.floor(Math.max(2, parentVal - 2) / 2));
            queue.push(rightId);
          }
        }
      }
      return allocations;
    };
`;

// Remove inner definition from Section B:
const innerStart = "      const allTreeNodesList = await MlmTree.find({}).lean();\n      const allTreeNodesMap = new Map(allTreeNodesList.map((t) => [String(t._id), t]));";
const innerEnd = "      const treeAllocations = computeDynamicTreeAllocations(rootNode?._id, effectiveGrand);";

const innerReplacement = "      const treeAllocations = computeDynamicTreeAllocations(rootNode?._id, effectiveGrand);";

const idx1 = code.indexOf(innerStart);
const idx2 = code.indexOf(innerEnd);

if (idx1 !== -1 && idx2 !== -1) {
  code = code.substring(0, idx1) + innerReplacement + code.substring(idx2 + innerEnd.length);
  console.log("Removed inner definition from inside if block!");
} else {
  console.log("Could not find inner definition:", idx1, idx2);
}

// Now insert funcDefinition right before 'if (integerIds > 0 && sectionB.length === 0)'
const insertAnchor = "    // Show User Pool Generated distribution cleanly\n    if (integerIds > 0 && sectionB.length === 0) {";
const targetInsert = funcDefinition + "\n    // Show User Pool Generated distribution cleanly\n    if (integerIds > 0 && sectionB.length === 0) {";

if (code.includes(insertAnchor)) {
  code = code.replace(insertAnchor, targetInsert);
  console.log("Inserted funcDefinition in outer scope!");
} else {
  console.log("Could not find insertAnchor");
}

fs.writeFileSync("backend/app/services/mlmService.js", code, "utf8");
console.log("All done!");

