document.addEventListener('DOMContentLoaded', function () {
  var canvas = document.getElementById('collab-map');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var tooltip = document.getElementById('collab-tooltip');

  // --- Institution data ---
  var institutions = [
    {
      name: 'Technical University of Munich',
      city: 'Munich, Germany',
      lat: 48.15, lon: 11.57,
      isHome: true,
      collaborators: []
    },
    {
      name: 'Technical University of Munich',
      city: 'Munich, Germany',
      lat: 48.15, lon: 11.58,
      sameAs: 0,
      collaborators: [
        { name: 'Johannes Zimmer', themes: 'Interacting particle systems, hydrodynamic limits, non-equilibrium fluctuations, multiplicative noise, coarse-graining' },
        { name: 'D. R. Michiel Renger', themes: 'Exclusion process, hydrodynamic limits, collisions, fluxes, large deviations' }
      ]
    },
    {
      name: 'Delft University of Technology',
      city: 'Delft, Netherlands',
      lat: 52.01, lon: 4.36,
      collaborators: [
        { name: 'Frank Redig', themes: 'Interacting particle systems, duality, orthogonal polynomials, fluctuations, sticky Brownian motion' }
      ]
    },
    {
      name: 'Cardiff University',
      city: 'Cardiff, United Kingdom',
      lat: 51.48, lon: -3.18,
      collaborators: [
        { name: 'Nicolas Dirr', themes: 'Langevin dynamics, multiplicative noise, covariance, reversibility, coarse-graining' }
      ]
    },
    {
      name: 'Imperial College London',
      city: 'London, United Kingdom',
      lat: 51.51, lon: -0.13,
      collaborators: [
        { name: 'Grigorios A. Pavliotis', themes: 'Langevin dynamics, stochastic analysis, diffusion processes, coarse-graining, multiplicative noise' }
      ]
    },
    {
      name: 'University of Modena and Reggio Emilia',
      city: 'Modena, Italy',
      lat: 44.65, lon: 10.93,
      collaborators: [
        { name: 'Gioia Carinci', themes: 'Interacting particle systems, duality, inclusion process, fluctuation fields, orthogonal polynomial duality' }
      ]
    },
    {
      name: 'INRAE / BioSP',
      city: 'Avignon, France',
      lat: 43.95, lon: 4.81,
      collaborators: [
        { name: 'Jérôme Coville', themes: 'Measure-valued stochastic models, spatial ecology, dispersal, vector-borne viruses' },
        { name: 'Raphaël Forien', themes: 'Measure-valued stochastic models, epidemiological dynamics, spatial stochastic processes' },
        { name: 'Samuel Soubeyrand', themes: 'Spatial ecology, dispersal models, biological invasions, mechanistic-statistical modelling' }
      ]
    },
    {
      name: 'University of Colima',
      city: 'Colima, Mexico',
      lat: 19.24, lon: -103.72,
      collaborators: [
        { name: 'Benjamín Vallejo Jiménez', themes: 'Stochastic control, anticipative noise, mathematical finance, consumption–investment' }
      ]
    },
    {
      name: 'University of Maine & MTBI network',
      city: 'United States',
      lat: 38.5, lon: -95.0,
      early: true,
      collaborators: [
        { name: 'David Hiebeler', themes: 'Mathematical biology, spatial population models, chytridiomycosis dynamics' },
        { name: 'Benjamin Richard Morin', themes: 'Mathematical biology, chytridiomycosis dynamics' },
        { name: 'Casandra Leann Pawling', themes: 'Mathematical biology, chytridiomycosis dynamics' },
        { name: 'Adrian Nicholas Smith', themes: 'Mathematical biology, chytridiomycosis dynamics' },
        { name: 'Linda Gao', themes: 'Mathematical biology, chytridiomycosis dynamics' }
      ]
    }
  ];

  // Simplified continent outlines: arrays of [lon, lat]
  var landmasses = [
    // Europe
    [[-10,36],[28,36],[36,46],[40,46],[37,57],[25,63],[30,70],[18,71],[14,69],[16,60],[8,58],[5,58],[-2,57],[-5,50],[-8,44],[-10,36]],
    // British Isles
    [[-5.5,50],[-3,58.5],[-2,58.5],[-4.5,60],[-7.5,58.5],[-5.5,50]],
    // North America
    [[-140,60],[-60,47],[-67,45],[-70,43],[-75,35],[-82,29],[-90,29],[-97,26],[-105,23],[-117,33],[-118,36],[-124,49],[-140,60]],
    // South America
    [[-80,12],[-62,10],[-35,-5],[-35,-23],[-55,-35],[-65,-55],[-76,-50],[-82,-35],[-80,12]],
    // Africa
    [[-18,16],[10,37],[36,30],[42,12],[51,12],[43,4],[36,-8],[30,-32],[18,-35],[8,-28],[-18,16]],
    // Asia (partial)
    [[36,46],[60,50],[80,44],[90,50],[105,50],[120,40],[130,33],[120,22],[100,10],[80,10],[68,24],[60,22],[50,28],[40,36],[36,46]],
    // Australia
    [[114,-22],[130,-18],[148,-18],[153,-27],[150,-38],[140,-40],[130,-34],[115,-34],[114,-22]],
    // Greenland
    [[-25,83],[−70,76],[-45,59],[-25,83]]
  ];

  // Equirectangular projection
  function project(lat, lon) {
    var x = (lon + 180) / 360 * canvas.width;
    var y = (90 - lat) / 180 * canvas.height;
    return { x: x, y: y };
  }

  var homePt, instPts = [];
  var pulses = [];
  var hovered = -1;

  function resize() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = Math.round(canvas.width * 0.46);
    homePt = project(institutions[0].lat, institutions[0].lon);
    instPts = institutions.map(function (inst) {
      return project(inst.lat, inst.lon);
    });
  }
  window.addEventListener('resize', resize);
  resize();

  // One pulse per non-home, non-sameAs institution
  institutions.forEach(function (inst, i) {
    if (inst.isHome || inst.sameAs !== undefined) return;
    pulses.push({ idx: i, t: Math.random() });
  });

  function drawLandmass(coords) {
    if (!coords || !coords.length) return;
    ctx.beginPath();
    var p0 = project(coords[0][1], coords[0][0]);
    ctx.moveTo(p0.x, p0.y);
    for (var i = 1; i < coords.length; i++) {
      var p = project(coords[i][1], coords[i][0]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(139,163,192,0.07)';
    ctx.strokeStyle = 'rgba(139,163,192,0.15)';
    ctx.lineWidth = 0.6;
    ctx.fill();
    ctx.stroke();
  }

  function arcControl(a, b) {
    var mx = (a.x + b.x) / 2;
    var my = (a.y + b.y) / 2 - Math.abs(a.x - b.x) * 0.18;
    return { x: mx, y: my };
  }

  function drawArc(from, to, alpha) {
    var c = arcControl(from, to);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(c.x, c.y, to.x, to.y);
    ctx.strokeStyle = 'rgba(143,179,220,' + (alpha * 0.35) + ')';
    ctx.lineWidth = 0.9;
    ctx.setLineDash([5, 7]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function quadPoint(from, to, t) {
    var c = arcControl(from, to);
    return {
      x: (1-t)*(1-t)*from.x + 2*(1-t)*t*c.x + t*t*to.x,
      y: (1-t)*(1-t)*from.y + 2*(1-t)*t*c.y + t*t*to.y
    };
  }

  function drawNode(pt, inst, i) {
    var isHov = (i === hovered);
    var isHome = inst.isHome;
    var r = isHome ? 7 : (isHov ? 7 : 5);
    var col = isHome ? '239,217,154' : (inst.early ? '120,140,160' : '143,179,220');

    // Glow
    var grd = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 3.5);
    grd.addColorStop(0, 'rgba(' + col + ',0.28)');
    grd.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r * 3.5, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Dot
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isHome ? '#EFD99A' : (inst.early ? 'rgba(120,140,160,0.75)' : '#8FB3DC');
    ctx.fill();
    if (isHov && !isHome) {
      ctx.strokeStyle = '#EFD99A';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Label (home always, others on hover)
    if (isHome) {
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.fillStyle = '#EFD99A';
      ctx.fillText('Munich', pt.x + r + 5, pt.y + 4);
    } else if (isHov) {
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = '#F0F4FA';
      ctx.fillText(inst.city, pt.x + r + 5, pt.y + 4);
    }
  }

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    landmasses.forEach(drawLandmass);

    // Connection arcs
    institutions.forEach(function (inst, i) {
      if (inst.isHome || inst.sameAs !== undefined) return;
      var alpha = (i === hovered) ? 1 : 0.6;
      drawArc(homePt, instPts[i], alpha);
    });

    // Travelling pulses
    pulses.forEach(function (p) {
      p.t = (p.t + 0.0025) % 1;
      var pt = quadPoint(homePt, instPts[p.idx], p.t);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(143,179,220,0.85)';
      ctx.fill();
    });

    // Nodes
    institutions.forEach(function (inst, i) {
      if (inst.sameAs !== undefined) return;
      drawNode(instPts[i], inst, i);
    });

    requestAnimationFrame(frame);
  }
  frame();

  // --- Hover ---
  function getHit(mx, my) {
    for (var i = institutions.length - 1; i >= 0; i--) {
      if (institutions[i].isHome || institutions[i].sameAs !== undefined) continue;
      var dx = mx - instPts[i].x;
      var dy = my - instPts[i].y;
      if (Math.sqrt(dx * dx + dy * dy) < 20) return i;
    }
    return -1;
  }

  canvas.addEventListener('mousemove', function (e) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    var mx = (e.clientX - rect.left) * scaleX;
    var my = (e.clientY - rect.top) * scaleY;

    hovered = getHit(mx, my);

    if (hovered !== -1) {
      var inst = institutions[hovered];
      var html = '<strong>' + inst.name + '</strong>'
        + '<div class="tt-city">' + inst.city + '</div>';
      inst.collaborators.forEach(function (c) {
        html += '<div class="tt-collab">'
          + '<span class="tt-name">' + c.name + '</span>'
          + '<div class="tt-themes">' + c.themes + '</div>'
          + '</div>';
      });
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';

      var mapRect = canvas.parentElement.getBoundingClientRect();
      var tx = e.clientX - mapRect.left + 16;
      var ty = e.clientY - mapRect.top - 16;
      if (tx + 290 > mapRect.width) tx = e.clientX - mapRect.left - 306;
      if (ty < 0) ty = 4;
      tooltip.style.left = tx + 'px';
      tooltip.style.top = ty + 'px';
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none';
      canvas.style.cursor = 'default';
    }
  });

  canvas.addEventListener('mouseleave', function () {
    hovered = -1;
    tooltip.style.display = 'none';
  });
});
