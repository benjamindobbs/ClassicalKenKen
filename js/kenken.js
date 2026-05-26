
// Production steps of ECMA-262, Edition 5, 15.4.4.14
// Reference: http://es5.github.io/#x15.4.4.14
if (!Array.prototype.indexOf) {
  Array.prototype.indexOf = function (searchElement, fromIndex) {

      var k;

      // 1. Let o be the result of calling ToObject passing
      //    the this value as the argument.
      if (this == null) {
          throw new TypeError('"this" is null or not defined');
      }

      var o = Object(this);

      // 2. Let lenValue be the result of calling the Get
      //    internal method of o with the argument "length".
      // 3. Let len be ToUint32(lenValue).
      var len = o.length >>> 0;

      // 4. If len is 0, return -1.
      if (len === 0) {
          return -1;
      }

      // 5. If argument fromIndex was passed let n be
      //    ToInteger(fromIndex); else let n be 0.
      var n = fromIndex | 0;

      // 6. If n >= len, return -1.
      if (n >= len) {
          return -1;
      }

      // 7. If n >= 0, then Let k be n.
      // 8. Else, n<0, Let k be len - abs(n).
      //    If k is less than 0, then let k be 0.
      k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);

      // 9. Repeat, while k < len
      while (k < len) {
          // a. Let Pk be ToString(k).
          //   This is implicit for LHS operands of the in operator
          // b. Let kPresent be the result of calling the
          //    HasProperty internal method of o with argument Pk.
          //   This step can be combined with c
          // c. If kPresent is true, then
          //    i.  Let elementK be the result of calling the Get
          //        internal method of o with the argument ToString(k).
          //   ii.  Let same be the result of applying the
          //        Strict Equality Comparison Algorithm to
          //        searchElement and elementK.
          //  iii.  If same is true, return k.
          if (k in o && o[k] === searchElement) {
              return k;
          }
          k++;
      }
      return -1;
  };
}

var container;
var table;
var size;
var board;
var region;
var cellBorderElems;
var cellElems;
var operElems;
var operators;
var memos;
var selectedCell = null;
var selectedCoords = null;
var messageElem;
var startTime;
var finishTime;
var spentTime = 0;
var gameOver = false;
var hintsGiven = 0;
var hintLocations =[];
var lockedCells = new Set();
var guesses = 0;
var score = 0;
var rank;

function iterateCells(func) {
  for (var iy = 0; iy < size; iy++) {
      for (var ix = 0; ix < size; ix++) {
          func(ix, iy);
      }
  }
}

function solve() {
  iterateCells(function (ix, iy) {
      var valueDiv = document.getElementById('r' + iy + 'c' + ix);
      valueDiv.innerHTML = board[ix + iy * size];
      valueDiv.style.display = 'block';
  });
  finishTime = Date.now();
  gameOver = true;
}

function hide() {
  iterateCells(function (ix, iy) {
      var valueDiv = document.getElementById('r' + iy + 'c' + ix);
      valueDiv.style.display = 'none';
      valueDiv.innerHTML = '';
      cellElems[ix + iy * size].style.cursor = '';
  });
  lockedCells = new Set();
  hintsGiven=0;
  giveHints(setHintDifficulty(rank));
}

function showWinMessage() {
  messageElem.innerHTML = "Congratulations!<br>Score: " + Math.floor(score);
}

function checkAnswer() {
  var correct = true;
  
  iterateCells(function (ix, iy) {
      var valueDiv = document.getElementById('r' + iy + 'c' + ix);
      // String based comparison because valueDiv may contain whitespace
      if (board[ix + iy * size].toString() !== valueDiv.innerHTML)
          correct = false;
  });
  if (correct) {
      gameOver = true;
      finishTime = Date.now();
      var time = (finishTime - startTime) / 1000;
      var unsolved = (size * size) - hintsGiven;
      score = Math.round(((unsolved / guesses) + (2.5 * unsolved / time)) * size * 10);
      var currentLevel = Math.floor(rank);
      var nextThreshold = LEVEL_STARTS[Math.min(currentLevel, LEVEL_STARTS.length - 1)];
      score = Math.min(score, Math.round(nextThreshold * 1.5));
      writeScore(score, size).then(function(avg) {
          if (avg != null) setTimeout(function() { showRankProgress(avg); }, 1000);
      });
      showWinMessage();
  }
}

function updateTime(evt) {
  var endTime = gameOver ? finishTime : Date.now();
  document.getElementById("time").innerHTML = Math.floor((endTime - startTime) / 1000 + spentTime);
}

 function startGame(){
  guesses=0;
  generateBoard();
  setInterval(updateTime, 1000);

}

function createElements() {
  lockedCells = new Set();
  cellBorderElems = new Array(size * size);
  cellElems = new Array(size * size);
  operElems = new Array(size * size);

  // The containers are nested so that the inner container can be easily
  // discarded to recreate the whole game.
  var outerContainer = document.getElementById("container");
  if (container)
      outerContainer.removeChild(container);
  container = document.createElement("div");
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'center';
  outerContainer.appendChild(container);

  table = document.createElement("div");
  table.style.borderStyle = 'solid';
  table.style.borderWidth = '2px';
  table.style.borderColor = '#0f172a';
  table.style.boxShadow = '0 4px 24px rgba(0,0,0,0.10)';
  table.style.position = 'relative';
  table.style.width = (size * 4. + 0.5) + 'em';
  table.style.height = (size * 4. + 0.5) + 'em';

  if (size <= 3) table.style.fontSize = '22px';
  else if (size === 4) table.style.fontSize = '19px';

  messageElem = document.createElement('div');
  container.appendChild(messageElem);
  messageElem.style.fontFamily = 'inherit';
  messageElem.style.fontSize = '1.125rem';
  messageElem.style.fontWeight = '700';
  messageElem.style.position = 'relative';
  messageElem.style.color = '#059669';
  messageElem.style.padding = '0.5rem 0';

  container.appendChild(table);
  for (var iy = 0; iy < size; iy++) {
      for (var ix = 0; ix < size; ix++) {
          var cellBorder = document.createElement("div");
          cellBorder.style.width = '3.9em';
          cellBorder.style.height = '3.9em';
          cellBorder.style.position = 'absolute';
          cellBorder.style.top = (4.0 * iy + 0.2) + 'em';
          cellBorder.style.left = (4.0 * ix + 0.2) + 'em';
          cellBorder.style.verticalAlign = 'middle';
          cellBorderElems[ix + iy * size] = cellBorder;
          table.appendChild(cellBorder);

          var cell = document.createElement("div");
          cellElems[ix + iy * size] = cell;
          cell.innerHTML = "";
          cell.style.width = '3.5em';
          cell.style.height = '3.5em';
          cell.style.position = 'absolute';
          cell.style.top = '0.125em';
          cell.style.left = '0.125em';
          cell.style.verticalAlign = 'middle';
          cell.className = 'kk-cell';
          cell.tabIndex = 0;
          cell.onclick = function () { selectCell(this); };
          cell.addEventListener('focus', function() { selectCell(this); });
          cellBorder.appendChild(cell);

          var operElem = document.createElement('div');
          operElem.style.position = 'absolute';
          operElem.style.top = '0px';
          operElem.style.fontSize = '0.58em';
          operElem.style.fontWeight = '700';
          operElem.style.color = '#1e293b';
          operElem.style.lineHeight = '1';
          operElem.style.padding = '2px 3px';
          operElem.style.pointerEvents = 'none';
          cell.appendChild(operElem);
          operElems[ix + iy * size] = operElem;

          var valueDiv = document.createElement("div");
          valueDiv.id = 'r' + iy + 'c' + ix;
          valueDiv.style.fontSize = '1.5em';
          valueDiv.style.fontWeight = '600';
          valueDiv.style.color = '#0f172a';
          valueDiv.style.position = 'absolute';
          valueDiv.style.top = '50%';
          valueDiv.style.width = '100%';
          valueDiv.style.textAlign = 'center';
          valueDiv.innerHTML = '&nbsp;';
          cell.appendChild(valueDiv);
          var r = valueDiv.getBoundingClientRect();
          valueDiv.style.marginTop = Math.round(-(r.bottom - r.top) / 2) + 'px';
          valueDiv.style.display = 'none';

          var memoElem = document.createElement("div");
          memoElem.id = 'memo_r' + iy + 'c' + ix;
          memoElem.style.fontSize = '0.5em';
          memoElem.style.position = 'relative';
          memoElem.style.top = '100%';
          memoElem.style.marginTop = '-1em';
          memoElem.innerHTML = '';
          var currentSet = memos[ix + iy * size];
          for (var j = 0; j < size; j++)
              if (currentSet & (1 << j))
                  memoElem.innerHTML += (j + 1).toString();
          cell.appendChild(memoElem);
      }
  }
  var answers = document.createElement('div');
  container.appendChild(answers);
  answers.style.fontSize = '1rem';
  answers.style.padding = '0.875rem 0 0.5rem';
  answers.style.display = 'flex';
  answers.style.gap = '0.5rem';
  answers.style.alignItems = 'center';
  answers.style.flexWrap = 'wrap';
  answers.innerHTML = '<span style="font-size:0.8125rem;font-weight:600;color:#64748b;margin-right:0.25rem;">Answer</span>';

  function addAnswer(str) {
      var a = document.createElement('span');
      answers.appendChild(a);
      a.innerHTML = str;
      a.style.display = 'inline-flex';
      a.style.alignItems = 'center';
      a.style.justifyContent = 'center';
      a.style.width = '2.25rem';
      a.style.height = '2.25rem';
      a.style.border = '1px solid #d1d5db';
      a.style.borderRadius = '6px';
      a.style.fontWeight = '600';
      a.style.background = '#ffffff';
      a.style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)';
      a.className = 'kk-answer-btn';
      a.onclick = function () {
          if (selectedCoords) {
              var cellIdx = selectedCoords[0] + selectedCoords[1] * size;
              if (lockedCells.has(cellIdx)) return;
              var valueDiv = document.getElementById('r' + selectedCoords[1] + 'c' + selectedCoords[0]);
              valueDiv.style.display = 'block';
              valueDiv.innerHTML = this.innerHTML;
              valueDiv.style.color = '#0f172a';
              checkAnswer();
              guesses=guesses+1;
          }
      };
  }

  for (var i = 0; i < size; i++) {
      addAnswer((i + 1).toString());
  }
  addAnswer('&nbsp;');

  var memoContainer = document.createElement('div');
  container.appendChild(memoContainer);
  memoContainer.style.fontSize = '0.875rem';
  memoContainer.style.padding = '0.25rem 0 0.75rem';
  memoContainer.style.display = 'flex';
  memoContainer.style.gap = '0.375rem';
  memoContainer.style.alignItems = 'center';
  memoContainer.style.flexWrap = 'wrap';
  memoContainer.innerHTML = '<span style="font-size:0.8125rem;font-weight:600;color:#64748b;margin-right:0.25rem;">Memo</span>';
  for (var i = 0; i < size; i++) {
      var a = document.createElement('span');
      memoContainer.appendChild(a);
      a.innerHTML = (i + 1).toString();
      a.style.display = 'inline-flex';
      a.style.alignItems = 'center';
      a.style.justifyContent = 'center';
      a.style.width = '1.875rem';
      a.style.height = '1.875rem';
      a.style.border = '1px solid #e2e8f0';
      a.style.borderRadius = '4px';
      a.style.fontWeight = '500';
      a.style.background = '#f8fafc';
      a.style.fontSize = '0.8125rem';
      a.className = 'kk-memo-btn';
      a.onclick = function () {
          if (selectedCoords) {
              var memoElem = document.getElementById('memo_r' + selectedCoords[1] + 'c' + selectedCoords[0]);
              memoElem.style.display = 'block';
              var currentSet = memos[selectedCoords[0] + selectedCoords[1] * size];
              currentSet ^= 1 << (Number(this.innerHTML) - 1);
              memos[selectedCoords[0] + selectedCoords[1] * size] = currentSet;
              memoElem.innerHTML = '';
              for (var j = 0; j < size; j++)
                  if (currentSet & (1 << j))
                      memoElem.innerHTML += (j + 1).toString();
          }
      }
  }

}

// ── Rank progress bar ────────────────────────────────────────────────────────
// First avg score that places a player into each rank level (1–7).
var LEVEL_STARTS = [0, 25, 42, 58, 72, 84, 94];

function computeRankProgress(avg) {
  var level = 1;
  for (var i = LEVEL_STARTS.length - 1; i >= 0; i--) {
    if (avg >= LEVEL_STARTS[i]) { level = i + 1; break; }
  }
  if (level >= 7) return { level: 7, next: null, pct: 1.0 };
  var start = LEVEL_STARTS[level - 1];
  var end   = LEVEL_STARTS[level];
  var pct   = Math.max(0, Math.min(1, (avg - start) / (end - start)));
  return { level: level, next: level + 1, pct: pct };
}

function showRankProgress(avg) {
  var existing = document.getElementById('rank-progress-bar');
  if (existing) existing.remove();

  var p = computeRankProgress(avg);
  var gridPx = table.offsetWidth;

  var wrapper = document.createElement('div');
  wrapper.id = 'rank-progress-bar';
  wrapper.style.width = gridPx + 'px';
  wrapper.style.marginTop = '1.25rem';
  wrapper.style.opacity = '0';
  wrapper.style.transition = 'opacity 0.3s ease';

  // Header
  var header = document.createElement('div');
  header.textContent = 'Rank Progress';
  header.style.fontSize = '0.6875rem';
  header.style.fontWeight = '700';
  header.style.letterSpacing = '0.09em';
  header.style.textTransform = 'uppercase';
  header.style.color = '#94a3b8';
  header.style.marginBottom = '0.5rem';
  wrapper.appendChild(header);

  // Rank labels
  var labels = document.createElement('div');
  labels.style.display = 'flex';
  labels.style.justifyContent = 'space-between';
  labels.style.fontSize = '0.875rem';
  labels.style.fontWeight = '700';
  labels.style.marginBottom = '0.375rem';

  var lLeft = document.createElement('span');
  lLeft.textContent = 'Rank ' + p.level;
  lLeft.style.color = '#0f172a';

  var lRight = document.createElement('span');
  lRight.textContent = p.next ? 'Rank ' + p.next : 'Max';
  lRight.style.color = '#94a3b8';

  labels.appendChild(lLeft);
  labels.appendChild(lRight);
  wrapper.appendChild(labels);

  // Track
  var track = document.createElement('div');
  track.style.width = '100%';
  track.style.height = '10px';
  track.style.background = '#e2e8f0';
  track.style.borderRadius = '9999px';
  track.style.overflow = 'hidden';
  wrapper.appendChild(track);

  // Fill (starts at 0, animates to target)
  var fill = document.createElement('div');
  fill.style.height = '100%';
  fill.style.width = '0%';
  fill.style.borderRadius = '9999px';
  fill.style.background = 'linear-gradient(90deg, #2563eb, #60a5fa)';
  fill.style.transition = 'width 1s cubic-bezier(0.4, 0, 0.2, 1)';
  track.appendChild(fill);

  // Percentage caption
  var caption = document.createElement('div');
  caption.textContent = Math.round(p.pct * 100) + '% to next rank';
  caption.style.fontSize = '0.75rem';
  caption.style.color = '#64748b';
  caption.style.marginTop = '0.4rem';
  caption.style.textAlign = 'right';
  if (!p.next) caption.textContent = 'Maximum rank reached';
  wrapper.appendChild(caption);

  container.appendChild(wrapper);

  // Fade in and animate fill on next two frames
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      wrapper.style.opacity = '1';
      fill.style.width = Math.round(p.pct * 100) + '%';
    });
  });
}

function selectCell(sel) {
  selectedCell = sel;
  iterateCells(function (ix, iy) {
      var cell = cellElems[ix + iy * size];
      if (cell === sel) {
          cell.style.top = '0.075em';
          cell.style.left = '0.075em';
          cell.style.border = '2px solid #2563eb';
          cell.style.boxShadow = 'inset 0 0 0 1px #93c5fd';
          selectedCoords = [ix, iy];
      }
      else {
          cell.style.top = '0.125em';
          cell.style.left = '0.125em';
          cell.style.border = 'none';
          cell.style.boxShadow = 'none';
      }
  })
}

function paintCells(region) {
  var colors = [
      '#e2e8f0', // slate
      '#fecaca', // red
      '#bbf7d0', // green
      '#bfdbfe', // blue
      '#fef08a', // yellow
      '#a5f3fc', // cyan
      '#f5d0fe', // purple
      '#fca5a5', // deeper red
      '#86efac', // deeper green
      '#d8b4fe', // deeper purple
      '#67e8f9', // deeper cyan
      '#93c5fd', // deeper blue
      '#6ee7b7', // emerald
      '#fdba74', // orange
      '#bef264', // lime
      '#f9a8d4', // pink
      '#c4b5fd', // violet
      '#f1f5f9', // near-white
  ];

  for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
          cellElems[x + y * size].style.backgroundColor = colors[region[x + y * size] % colors.length];
          var cellBorder = cellBorderElems[x + y * size];
          if (x <= 0 || region[x + y * size] !== region[x - 1 + y * size]) {
              cellBorder.style.borderLeft = "solid 2px #0f172a";
          }
          else {
              cellBorder.style.borderLeft = "solid 1px rgba(0,0,0,0.10)";
          }
          if (size <= x - 1 || region[x + y * size] !== region[x + 1 + y * size]) {
              cellBorder.style.borderRight = "solid 2px #0f172a";
          }
          else {
              cellBorder.style.borderRight = "solid 1px rgba(0,0,0,0.10)";
          }
          if (y <= 0 || region[x + y * size] !== region[x + (y - 1) * size]) {
              cellBorder.style.borderTop = "solid 2px #0f172a";
          }
          else {
              cellBorder.style.borderTop = "solid 1px rgba(0,0,0,0.10)";
          }
          if (size <= y - 1 || region[x + y * size] !== region[x + (y + 1) * size]) {
              cellBorder.style.borderBottom = "solid 2px #0f172a";
          }
          else {
              cellBorder.style.borderBottom = "solid 1px rgba(0,0,0,0.10)";
          }
      }
  }
}

function setOperatorElems(region) {
  // Clear the operator indicator before assigning one because
  // there could be old text from rejected tries.
  for (var i = 0; i < size * size; i++) {
      var operElem = operElems[i];
      operElem.innerHTML = '';
  }
  for (var i = 0; i < operators.length; i++) {
      var top, left;
      var first = true;
      iterateCells(function (ix, iy) {
          if (region[ix + iy * size] === i + 1) {
              if (first) {
                  top = iy;
                  left = ix;
              }
              first = false;
          }
      });
      var operElem = operElems[left + top * size];
      operElem.innerHTML = operators[i].product + operators[i].oper;
      operElem.style.position = 'absolute';
      operElem.style.top = '0px';
  }
}

function generateBoard() {
  try {
      generateBoardInt();
  } catch(e) {
      console.error(e);
  }
}

async function generateBoardInt() {
  const rankData = await getRank();
  rank = rankData.rank;
  setBoardDifficulty(rank);
  hintsGiven=0;
  board = new Array(size * size);
  region = new Array(size * size);
  memos = new Array(size * size); // Bitfield
  for (var i = 0; i < memos.length; i++) // Initialize with 0
      memos[i] = 0;
  operators = [];
  startTime = Date.now();
  finishTime = null;
  spentTime = 0;
  gameOver = false;
  updateTime();

  var latinSquareTries = 0;

  function genLatinSquare() {
      for (var iy = 0; iy < size; iy++) {
          for (var tries = 0; tries < 1000; tries++) {
              latinSquareTries++;
              if ((function () {
                  var next = board.slice(0);
                  // First, build an array of all available numbers for a row.
                  // We will randomly pick and delete from this array to enumerate permutation.
                  var avail = [];
                  for (var i = 0; i < size; i++)
                      avail.push(i + 1);
                  for (var ix = 0; ix < size; ix++) {
                      // Create a clone of available numbers array and delete numbers already used in column.
                      // This will greatly reduce the chance of invalid permutation, but it's not like
                      // it will never happen, so we still need to retry if permutation fails.
                      var vavail = avail.slice(0);
                      for (var j = 0; j < iy; j++) {
                          var vidx = vavail.indexOf(board[ix + j * size]);
                          if (0 <= vidx)
                              vavail.splice(vidx, 1);
                      }
                      // There's a possibility of using up all available numbers, in which case we should
                      // retry for this row.
                      // If we'd be sure to check every possible permutations, rather than retry with exactly
                      // the same conditions and new random numbers, we could use recursive calls to
                      // track all paths like the labeling algorithm, but it seems unnecessary around size 6.
                      if (vavail.length === 0)
                          return false;
                      var idx = Math.floor(Math.random() * vavail.length);
                      if (idx < 0)
                          return false;
                      next[ix + iy * size] = vavail[idx];
                      // The original available numbers array should always contain numbers picked from reduced array.
                      avail.splice(avail.indexOf(vavail[idx]), 1);
                  }
                  board = next;
                  return true;
              })())
                  break;
          }
      }
  }

  var allTries = 0;
  var solveTries = 0;

  function checkSolvability(region) {
      function sameVector(a, b) {
          for (var i = 0; i < a.length; i++)
              if (a[i] !== b[i])
                  return false;
          return true;
      }
      function columnVector(region, x) {
          var ret = [];
          for (var i = 0; i < size; i++)
              ret.push(region[x + i * size]);
          return ret;
      }

      // Check if the region definition has a duplicate row or column,
      // in which case it is clear that the problem cannot be solved
      // with single answer.  You could swap these rows or columns to
      // obtain another solution.
      for (var iy = 0; iy < size; iy++) {
          var row = region.slice(iy * size, (iy + 1) * size);
          for (var jy = iy + 1; jy < size; jy++)
              if (sameVector(row, region.slice(jy * size, (jy + 1) * size)))
                  return false;
      }
      for (var ix = 0; ix < size; ix++) {
          var col = columnVector(region, ix);
          for (var jx = ix + 1; jx < size; jx++)
              if (sameVector(col, columnVector(region, jx)))
                  return false;
      }

      genLatinSquare();
      setOperators(region);

      // Assigning true to this variable enables the debugger to let you see
      // the process of reducing solution possibilities by step execution.
      var visualizeSolveProcess = false;

      if (visualizeSolveProcess)
          setOperatorElems(region);

      /// The debug function to visualize the process.
      function showField(x, y) {
          if (!visualizeSolveProcess)
              return;
          var memoElem = document.getElementById('memo_r' + y + 'c' + x);
          memoElem.style.display = 'block';
          memoElem.innerHTML = '';
          for (var i = 0; i < size; i++)
              if (field[x + y * size] & (1 << i))
                  memoElem.innerHTML += (i + 1).toString();
      }

      // 'field' is an array of bitfields for possibilities.
      // Using bitfields rather than arrays enables fast operations
      // (especially cloning) but limits maximum size.
      // Since JavaScript bitwise operators works with 32 bits,
      // we're safe to use it as a bitfield for puzzle sizes up to 9.
      var field = new Array(size * size);
      for (var iy = 0; iy < size; iy++) {
          for (var ix = 0; ix < size; ix++) {
              var currentSet = 0;
              for (var i = 0; i < size; i++)
                  currentSet |= 1 << i;
              field[ix + iy * size] = currentSet;
              showField(ix, iy);
          }
      }

      // From this point, the codes tries to find an answer by reducing
      // possibilities in each cells.
      // We do not fully trace all possible combinations, because the
      // number of combinations are too large to enumerate
      // (10^9 for a size 6 latin square, according to
      //  https://en.wikipedia.org/wiki/Latin_square ),
      // and it's not the method humans normally use.
      // We only check all combinations in operator partitions, which
      // humans can do.
      for (var n = 0; n < 10; n++) {
          var prevField = field.slice(0);

          for (var i = 0; i < operators.length; i++) {
              var cellPos = [];
              iterateCells(function (ix, iy) {
                  if (region[ix + iy * size] === i + 1) {
                      cellPos.push([ix, iy]);
                  }
              });
              if (cellPos.length === 0)
                  break;
              if (operators[i].oper == '*') {
                  for (var j = 0; j < size; j++) {
                      if (operators[i].product % (j + 1) !== 0) {
                          for (var k = 0; k < cellPos.length; k++) {
                              var ix = cellPos[k][0];
                              var iy = cellPos[k][1];
                              field[ix + iy * size] &= ~(1 << j);
                              showField(ix, iy);
                          }
                      }
                  }
              }
              if (operators[i].oper == '/') {
                  var jx = cellPos[0][0];
                  var jy = cellPos[0][1];
                  var jfield = field[jx + jy * size];
                  var jvalid = 0;
                  var kx = cellPos[1][0];
                  var ky = cellPos[1][1];
                  var kfield = field[kx + ky * size];
                  var kvalid = 0;
                  for (var j = 0; j < size; j++) {
                      if (!(jfield & (1 << j)))
                          continue;
                      for (var k = 0; k < size; k++) {
                          if (!(kfield & (1 << k)))
                              continue;
                          var jv = j + 1;
                          var kv = k + 1;
                          if (jv < kv) {
                              if (kv / jv === operators[i].product) {
                                  jvalid |= 1 << j;
                                  kvalid |= 1 << k;
                              }
                          }
                          else {
                              if (jv / kv === operators[i].product) {
                                  jvalid |= 1 << j;
                                  kvalid |= 1 << k;
                              }
                          }
                      }
                  }

                  jfield &= jvalid;
                  field[jx + jy * size] = jfield;
                  showField(jx, jy);
                  kfield &= kvalid;
                  field[kx + ky * size] = kfield;
                  showField(kx, ky);
              }
              if (operators[i].oper == '-') {
                  var jx = cellPos[0][0];
                  var jy = cellPos[0][1];
                  var jfield = field[jx + jy * size];
                  var jvalid = 0;
                  var kx = cellPos[1][0];
                  var ky = cellPos[1][1];
                  var kfield = field[kx + ky * size];
                  var kvalid = 0;
                  for (var j = 0; j < size; j++) {
                      if (!(jfield & (1 << j)))
                          continue;
                      for (var k = 0; k < size; k++) {
                          if (!(kfield & (1 << k)))
                              continue;
                          var jv = j + 1;
                          var kv = k + 1;
                          if (jv < kv) {
                              if (kv - jv === operators[i].product) {
                                  jvalid |= 1 << j;
                                  kvalid |= 1 << k;
                              }
                          }
                          else {
                              if (jv - kv === operators[i].product) {
                                  jvalid |= 1 << j;
                                  kvalid |= 1 << k;
                              }
                          }
                      }
                  }

                  jfield &= jvalid;
                  field[jx + jy * size] = jfield;
                  showField(jx, jy);
                  kfield &= kvalid;
                  field[kx + ky * size] = kfield;
                  showField(kx, ky);
              }
              if (operators[i].oper === '+' || operators[i].oper === '*') {
                  // Recursively checks possible combinations for addition
                  // or multiplcation operator
                  function checkAddOper(field, j, k, sum, stop) {
                      solveTries++;
                      var next = field.slice(0);
                      var jx = cellPos[j][0];
                      var jy = cellPos[j][1];
                      if (!(next[jx + jy * size] & (1 << k)))
                          return false;
                      if (operators[i].oper === '+')
                          sum += k + 1;
                      else
                          sum *= k + 1;
                      // Even before we add all cells, we are sure that
                      // sum greater than the operator's value is not possible.
                      if (operators[i].product < sum)
                          return false;
                      next[jx + jy * size] = (1 << k);
                      for (var l = 0; l < size; l++) {
                          if (l !== jx)
                              next[l + jy * size] &= ~(1 << k);
                          if (l !== jy)
                              next[jx + l * size] &= ~(1 << k);
                      }
                      j = (j + 1) % cellPos.length;
                      if (j === stop)
                          return sum === operators[i].product;
                      for (var l = 0; l < size; l++) {
                          var ret = checkAddOper(next, j, l, sum, stop);
                          if (ret)
                              return true;
                      }
                      return false;
                  }

                  for (var j = 0; j < cellPos.length; j++) {
                      for (var l = 0; l < size; l++) {
                          var ret = checkAddOper(field, j, l, operators[i].oper === '+' ? 0 : 1, j);
                          var jx = cellPos[j][0];
                          var jy = cellPos[j][1];
                          if (!ret)
                              field[jx + jy * size] &= ~(1 << l);
                          showField(jx, jy);
                      }
                  }
              }
          }

          function checkRowCell(ix, iy, k, field, axis, stop) {
              solveTries++;
              var next = field.slice(0);
              if (!(next[ix + iy * size] & (1 << k)))
                  return false;
              next[ix + iy * size] = (1 << k);
              for (var l = 0; l < size; l++) {
                  if (l !== ix) {
                      next[l + iy * size] &= ~(1 << k);
                      if (next[l + iy * size] === 0)
                          return false;
                  }
                  if (l !== iy) {
                      next[ix + l * size] &= ~(1 << k);
                      if (next[ix + l * size] === 0)
                          return false;
                  }
              }
              if (axis === 0)
                  ix = (ix + 1) % size;
              else
                  iy = (iy + 1) % size;
              if ((axis === 0 ? ix : iy) !== stop) {
                  for (var l = 0; l < size; l++)
                      if (checkRowCell(ix, iy, l, next, axis, stop))
                          return true;
                  return false;
              }
              else {
                  return true;
              }
          }

          for (var iy = 0; iy < size; iy++) {
              for (var ix = 0; ix < size; ix++) {
                  for (var k = 0; k < size; k++) {
                      var ret = checkRowCell(ix, iy, k, field, 0, ix);
                      if (!ret) {
                          field[ix + iy * size] &= ~(1 << k);
                          showField(ix, iy);
                      }
                  }
              }
          }

          for (var ix = 0; ix < size; ix++) {
              for (var iy = 0; iy < size; iy++) {
                  for (var k = 0; k < size; k++) {
                      var ret = checkRowCell(ix, iy, k, field, 1, iy);
                      if (!ret) {
                          field[ix + iy * size] &= ~(1 << k);
                          showField(ix, iy);
                      }
                  }
              }
          }
          if (sameVector(prevField, field))
              break;
      }

      for (var i = 0; i < size * size; i++) {
          var count = 0;
          for (var k = 0; k < size; k++)
              if (field[i] & (1 << k))
                  count++;
          if (1 < count)
              return false;
      }
      return true;
  }

  function growCells(type, region) {
      function growCellSingle(x, y, type, region, cells) {
          allTries++;
          var next = region.slice(0);
          var avail = [];
          if (2 <= cells) {
              avail.push({
                  func: function () {
                      var ret = growCells(type, region);
                      if (ret)
                          return ret;
                      paintCells(region);
                  }, data: null,
                  weight: 3
              }); // Prioritize small regions by weighting option for creating new regions
          }
          next[x + y * size] = type;
          if (cells < 3) {
              var deltax = [-1, 0, 1, 0];
              var deltay = [0, -1, 0, 1];
              for (var i = 0; i < 4; i++) {
                  var newx = x + deltax[i];
                  var newy = y + deltay[i];
                  if (newx < 0 || size <= newx || newy < 0 || size <= newy)
                      continue;
                  if (region[newx + newy * size])
                      continue;
                  avail.push({
                      func: function (data) {
                          paintCells(next);
                          return growCellSingle(data[0], data[1], type, next, cells + 1);
                      },
                      data: [newx, newy],
                      weight: 1
                  });
              }
          }

          // Backtrack all available options recursively
          while (avail.length) {
              // Options have weights, so we first measure total weight
              var allWeight = 0;
              for (var j = 0; j < avail.length; j++)
                  allWeight += avail[j].weight;
              // Obtain value for selecting an option
              var val = Math.random() * allWeight;
              // Accumulate weights and find the corresponding option
              allWeight = 0;
              for (var j = 0; j < avail.length; j++) {
                  allWeight += avail[j].weight;
                  if (val < allWeight) {
                      ret = avail[j].func(avail[j].data);
                      if (ret)
                          return ret;
                      avail.splice(j, 1);
                      break;
                  }
              }
          }
          // At least 2 cells are required
          if (cells < 1)
              return null;
          return growCells(type, next);
      }

      function growCellTry(type, region) {

          for (var iy = 0; iy < size; iy++) {
              for (var ix = 0; ix < size; ix++) {
                  if (region[ix + iy * size] === 0) {
                      return growCellSingle(ix, iy, ++type, region, 0);
                  }
              }
          }
          if (iy == size)
              return region;
          else
              return false;
      }

      var numTries = 1;
      for (var tries = 0; tries < numTries; tries++) {
          var ret = growCellTry(type, region);
          if (ret)
              return ret;
      }
      // If all tries fail, return null
      return null;
  }

  for (var iy = 0; iy < size; iy++) {
      for (var ix = 0; ix < size; ix++) {
          region[ix + iy * size] = 0;
      }
  }

  createElements();

  selectCell(null);

  function setOperators(region) {
      operators = [];
      for (var i = 1; i < 100; i++) {
          var cellValues = [];
          iterateCells(function (ix, iy) {
              if (region[ix + iy * size] === i) {
                  cellValues.push(board[ix + iy * size]);
              }
          });
          if (cellValues.length === 0)
              break;
          var avail = ['*', '+'];
          if (cellValues.length === 2)
              avail.push('-');
          // If numbers are not dividable to each other, we can't use it for division operator
          if (cellValues.length === 2 && (cellValues[0] % cellValues[1] === 0 || cellValues[1] % cellValues[0] === 0))
              avail.push('/');
          var index = Math.floor(Math.random() * avail.length);
          var oper = avail[index];
          var product;
          if (oper === '+') {
              product = 0;
              for (var j = 0; j < cellValues.length; j++)
                  product += cellValues[j];
          }
          else if (oper === '*') {
              product = 1;
              for (var j = 0; j < cellValues.length; j++)
                  product *= cellValues[j];
          }
          else if (oper === '-') {
              product = Math.abs(cellValues[1] - cellValues[0]);
          }
          else if (oper === '/') {
              product = cellValues[0] < cellValues[1] ? cellValues[1] / cellValues[0] : cellValues[0] / cellValues[1];
          }
          operators.push({
              oper: oper,
              product: product,
          })
      }
  }

  for (var tries = 0; tries < 100; tries++) {
      var ret = growCells(0, region);
      if (!ret)
          continue;
      if (!checkSolvability(ret))
          continue;
      region = ret;
      paintCells(region);
      setOperatorElems(region);
      break;
  }

  giveHints(setHintDifficulty(rank));
  var playerData = document.getElementById("playerData");
  playerData.innerHTML = "Current Rank " + Math.floor(rank);
};

function getSaveData(auto = false) {
  var key = auto ? 'WebKenKenAutoSave' : 'WebKenKen';
  var storage = localStorage.getItem(key);
  if (!storage)
      return null;
  content = JSON.parse(storage);
  var data = content['save'] && content['save']['save'];
  if (!data || !Number.isInteger(data.size) || data.size < 3) {
      localStorage.removeItem(key);
      return null;
  }
  return data;
}

function prepareSaveData() {
  var saveData = {};
  saveData.size = size;
  saveData.answer = [];
  iterateCells(function (ix, iy) {
      var valueDiv = document.getElementById('r' + iy + 'c' + ix);
      saveData.answer[ix + iy * size] = valueDiv.innerHTML;
  });
  saveData.board = board;
  saveData.region = region;
  saveData.operators = operators;
  saveData.memos = memos;
  if (gameOver)
      saveData.spentTime = (finishTime - startTime) / 1000 + spentTime;
  else
      saveData.spentTime = (Date.now() - startTime) / 1000 + spentTime;
  saveData.gameOver = gameOver;
  return saveData;
}

function save(auto = false) {
  if (!window.localStorage || !window.JSON) {
      if (!auto)
          alert('Your browser cannot save the game progress.');
      return;
  }
  if (!auto && getSaveData() && !confirm('There is already a saved progress. OK to overwrite?'))
      return;
  localStorage.setItem(auto ? 'WebKenKenAutoSave' : 'WebKenKen', JSON.stringify({ save: { save: prepareSaveData() } }));
}

function loadSaveData(saveData, length) {
  size = saveData.size;
  board = saveData.board;
  region = saveData.region;
  operators = saveData.operators;
  memos = saveData.memos;
  gameOver = saveData.gameOver || false;
  if (gameOver) {
      startTime = finishTime = 0;
  }
  else {
      startTime = Date.now();
      finishTime = saveData.finishTime || null;
  }
  spentTime = saveData.spentTime || 0;
  createElements();
  paintCells(region);
  selectCell(null);
  setOperatorElems(region);
  iterateCells(function (ix, iy) {
      var valueDiv = document.getElementById('r' + iy + 'c' + ix);
      valueDiv.innerHTML = saveData.answer[ix + iy * size];
      valueDiv.style.display = 'block';
  });
  updateTime();
  if (gameOver)
      showWinMessage();
}

function load(auto = false) {
  if (!window.localStorage || !window.JSON) {
      if (!auto)
          alert('Your browser cannot save the game progress.');
      return;
  }
  var saveData = getSaveData(auto);
  if (!saveData) {
      if (!auto)
          alert('There is no saved game');
      return;
  }
  loadSaveData(saveData, localStorage[auto ? 'WebKenKenAutoSave' : 'WebKenKen'].length);
}

window.addEventListener('pageshow', function () {
  load(true);
});

window.addEventListener('beforeunload', function () {
  save(true);
});

function giveHints(numHints){
  hintLocations=[];
  if(hintsGiven===0){
    for(var i=0;i<numHints;i++){
      var iy = Math.floor(Math.random()*size);
      var ix = Math.floor(Math.random()*size);
      if(!checkRepeat([iy,ix])){
        hintLocations.push([iy,ix]);
        var valueDiv = document.getElementById('r' + iy + 'c' + ix);
        valueDiv.innerHTML = board[ix + iy * size];
        valueDiv.style.display = 'block';
        valueDiv.style.color = '#2563eb';
        lockedCells.add(ix + iy * size);
        cellElems[ix + iy * size].style.cursor = 'default';
      }else{
        i--;
      }
    }
    hintsGiven=numHints;
    function checkRepeat(arr) {
      return hintLocations.some(subArray =>
        subArray.length === arr.length && subArray.every((value, index) => value === arr[index])
      );
    }
  }
}

  function setBoardDifficulty(difficultyRating){
    if(Math.floor(difficultyRating)<7){
    size = Math.floor(difficultyRating)+2;
    }else{
        size=9;
    }
  }

  function setHintDifficulty(difficultyRating){
    var partialRank = difficultyRating - Math.floor(difficultyRating);
    if(difficultyRating<7){
        if(partialRank<.1){
            return Math.floor(size*size/3);
          }
          else if(partialRank<.3){
            return Math.floor(size*size/4);
          }
          else if(partialRank<.5){
            return Math.floor(size*size/5);
          }
          else if(partialRank<.8){
              return Math.floor(size*size/6);
            }
          else if(partialRank>.8){
          return Math.floor(size*size/7);
          }
    }else{
        return 0;
    }

  }

function moveSelection(dx, dy) {
    if (!selectedCoords || !cellElems) return;
    var nx = (selectedCoords[0] + dx + size) % size;
    var ny = (selectedCoords[1] + dy + size) % size;
    cellElems[nx + ny * size].focus();
}

document.addEventListener('keydown', function(e) {
    if (!selectedCoords || gameOver) return;
    var ix = selectedCoords[0];
    var iy = selectedCoords[1];

    if (e.key === 'ArrowRight') { e.preventDefault(); moveSelection(1, 0);  return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); moveSelection(-1, 0); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveSelection(0, 1);  return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveSelection(0, -1); return; }

    if (lockedCells.has(ix + iy * size)) return;

    var num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= size) {
        e.preventDefault();
        var valueDiv = document.getElementById('r' + iy + 'c' + ix);
        valueDiv.style.display = 'block';
        valueDiv.innerHTML = num.toString();
        valueDiv.style.color = '#0f172a';
        guesses++;
        checkAnswer();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        var valueDiv = document.getElementById('r' + iy + 'c' + ix);
        valueDiv.style.display = 'none';
        valueDiv.innerHTML = '';
    }
});