(function () {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if ('ontouchstart' in window && !window.matchMedia('(pointer: fine)').matches) return;

    var img = document.querySelector('.center-image');
    if (!img) return;

    var PAD = 0.1; // 10% padding on each side for edge overflow

    function setup() {
        var rect = img.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        var dpr = window.devicePixelRatio || 1;
        var canvas = document.createElement('canvas');

        // Canvas is larger than the image to allow edge overflow
        var padX = rect.width * PAD;
        var padY = rect.height * PAD;
        var cw = rect.width + padX * 2;
        var ch = rect.height + padY * 2;

        var w = Math.round(cw * dpr);
        var h = Math.round(ch * dpr);
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        canvas.style.margin = -padY + 'px ' + -padX + 'px';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', img.alt || 'Photo');

        var gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: false });
        if (!gl) return;

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);

        // UV range for the image within the padded canvas
        // Image maps to [PAD/(1+2*PAD), 1-PAD/(1+2*PAD)] in canvas UV
        var lo = PAD / (1 + 2 * PAD);
        var hi = 1.0 - lo;

        var vsrc =
            'attribute vec2 a_pos;' +
            'attribute vec2 a_uv;' +
            'varying vec2 v_uv;' +
            'void main(){' +
            '  gl_Position=vec4(a_pos,0,1);' +
            '  v_uv=a_uv;' +
            '}';

        var fsrc =
            'precision highp float;' +
            'uniform sampler2D u_tex;' +
            'uniform vec2 u_mouse;' +
            'uniform float u_str;' +
            'uniform float u_asp;' +
            'uniform vec2 u_bounds;' + // lo, hi
            'varying vec2 v_uv;' +
            'void main(){' +
            '  vec2 uv=v_uv;' +
            '  vec2 d=uv-u_mouse;' +
            '  d.x*=u_asp;' +
            '  float dist=length(d);' +
            '  float r=0.45;' +
            '  if(dist<r&&dist>0.0){' +
            '    float f=1.0-dist/r;' +
            '    f=f*f;' +
            '    vec2 off=normalize(d)*f*0.15*u_str;' +
            '    off.x/=u_asp;' +
            '    uv-=off;' +
            '  }' +
            // Map from canvas UV to texture UV
            '  vec2 tuv=(uv-u_bounds.x)/(u_bounds.y-u_bounds.x);' +
            '  if(tuv.x<0.0||tuv.x>1.0||tuv.y<0.0||tuv.y>1.0){' +
            '    gl_FragColor=vec4(0);' +
            '  }else{' +
            '    gl_FragColor=texture2D(u_tex,tuv);' +
            '  }' +
            '}';

        function makeShader(type, src) {
            var s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
        }

        var vs = makeShader(gl.VERTEX_SHADER, vsrc);
        var fs = makeShader(gl.FRAGMENT_SHADER, fsrc);
        if (!vs || !fs) return;

        var prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
        gl.useProgram(prog);

        var posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);
        var aPos = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        var uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1
        ]), gl.STATIC_DRAW);
        var aUv = gl.getAttribLocation(prog, 'a_uv');
        gl.enableVertexAttribArray(aUv);
        gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        } catch (e) {
            return;
        }

        var uMouse = gl.getUniformLocation(prog, 'u_mouse');
        var uStr = gl.getUniformLocation(prog, 'u_str');
        var uAsp = gl.getUniformLocation(prog, 'u_asp');
        var uBounds = gl.getUniformLocation(prog, 'u_bounds');

        gl.uniform1f(uAsp, w / h);
        gl.uniform2f(uBounds, lo, hi);
        gl.viewport(0, 0, w, h);

        img.parentNode.insertBefore(canvas, img);
        img.style.display = 'none';

        var mx = 0.5, my = 0.5, tx = 0.5, ty = 0.5;
        var str = 0, tStr = 0;
        var hover = false, running = false;

        function draw() {
            mx += (tx - mx) * 0.1;
            my += (ty - my) * 0.1;
            str += (tStr - str) * 0.08;

            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform2f(uMouse, mx, my);
            gl.uniform1f(uStr, str);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            if (hover || str > 0.001) {
                requestAnimationFrame(draw);
            } else {
                str = 0;
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.uniform1f(uStr, 0);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                running = false;
            }
        }

        function start() {
            if (!running) { running = true; draw(); }
        }

        canvas.addEventListener('mousemove', function (e) {
            var r = canvas.getBoundingClientRect();
            tx = (e.clientX - r.left) / r.width;
            ty = 1.0 - (e.clientY - r.top) / r.height;
            tStr = 1;
            hover = true;
            start();
        });

        canvas.addEventListener('mouseleave', function () {
            tStr = 0;
            hover = false;
        });

        gl.uniform2f(uMouse, 0.5, 0.5);
        gl.uniform1f(uStr, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    if (img.complete && img.naturalWidth > 0) {
        setup();
    } else {
        img.addEventListener('load', setup);
    }
})();
