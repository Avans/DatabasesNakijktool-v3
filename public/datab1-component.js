// Brightspace component for the SQL nakijktool.
//
// Usage on a Brightspace page:
//   <script src="https://<your-app>.vercel.app/datab1-component.js"></script>
//   <wd-datab1 aid="21601"></wd-datab1>
//
// The API base URL defaults to the host this script is served from, so the
// component keeps working if the Vercel project is ever renamed. Override it
// by setting window.NAKIJK_API_URL before loading this script.

const API_URL = (function () {
    if (typeof window !== 'undefined' && window.NAKIJK_API_URL) {
        return window.NAKIJK_API_URL.replace(/\/$/, '') + '/assignments/';
    }

    // document.currentScript points at this <script> tag while it is running.
    if (document.currentScript && document.currentScript.src) {
        return new URL('.', document.currentScript.src).href + 'assignments/';
    }

    return '/assignments/';
})();

const template = document.createElement('template');

template.innerHTML = `
    <style>
        .container {
            display:flex;
            flex-direction: column;
            max-width:800px;
            border:1px solid black;
            padding:5px;
        }

        textarea {
            min-height:100px;
            max-width:100%;
            min-width:100%;
            padding:5px;
            font-family: monospace;
        }

        h2 {
            margin:0;
        }

        .toggle {
            color: #00AEED;
            padding: 4px 15px;
            font-size: 10px;
            background-color:transparent;
            border:none;
            border-radius:4px;
            text-align:left;
        }

        .toggle:hover {
            cursor:pointer;
            background-color:#eee;
        }

        .submit[disabled] {
            opacity: 0.6;
            cursor: default;
        }

        .feedback
        {
            color: rgba(255,255,255, 0.84);
            padding:10px;
            margin:5px;
            white-space: pre-line;
        }

        .feedback.pending {
            background-color: #2e2e2e;
        }

        .feedback.correct {
            background-color: #5cb85c;
        }

        .feedback.wrong {
            background-color: #f0ad4e;
        }

        .feedback.error {
            background-color: #d9534f;
        }

        .feedback span {
            font-weight: bold;
            display:block;
        }

        .feedback p {
            margin:0;
        }
    </style>
`;

class Datab1 extends HTMLElement {
    constructor() {
        super();

        this.api = new DatabApi();

        const shadowRoot = this.attachShadow({ mode: 'closed' });
        shadowRoot.appendChild(template.content.cloneNode(true));
        this.aid = this.getAttribute('aid');
        this.uid = this.api.getUserIdFromLocalStorage();

        let root = document.createElement('div');
        root.className = 'container';
        shadowRoot.appendChild(root);

        let a_root = document.createElement('div');
        a_root.className = 'container';

        this.drawAssignment(a_root);
        this.api.getAssignment(this.aid)
            .then(assignment => this.drawAssignment(a_root, assignment))
            .catch(() => this.drawError(a_root, 'De opdracht kon niet geladen worden.'));

        let s_root = document.createElement('div');
        s_root.className = 'container';

        this.drawSubmission(s_root);
        this.api.getSubmission(this.aid, this.uid)
            .then(submission => this.drawSubmission(s_root, submission))
            .catch(() => this.drawSubmission(s_root, {}));

        root.appendChild(a_root);
        root.appendChild(s_root);
    }

    drawError(container, text) {
        container.innerHTML = '';
        let feedback = document.createElement('div');
        feedback.className = 'feedback error';
        let span = document.createElement('span');
        span.innerText = 'Er ging iets mis';
        let p = document.createElement('p');
        p.innerText = text;
        feedback.appendChild(span);
        feedback.appendChild(p);
        container.appendChild(feedback);
    }

    drawAssignment(container, assignment) {
        container.innerHTML = '';

        if (!assignment) {
            let loader = document.createElement('p');
            loader.innerText = 'Loading...';
            container.appendChild(loader);
            return;
        }

        let h2 = document.createElement('h2');
        h2.innerText = assignment.title;

        let p = document.createElement('p');
        p.innerText = assignment.description;

        let output = document.createElement('div');
        output.style.display = 'none';
        output.innerHTML = assignment.expectedOutput;

        let show = false;
        let toggle = document.createElement('button');
        toggle.className = 'toggle';
        toggle.innerText = 'SHOW EXPECTED OUTPUT';
        toggle.addEventListener('click', () => {
            show = !show;
            output.style.display = show ? '' : 'none';
        });

        container.appendChild(h2);
        container.appendChild(p);
        container.appendChild(toggle);
        container.appendChild(output);
    }

    drawSubmission(container, submission) {
        container.innerHTML = '';

        if (!submission) {
            let loader = document.createElement('p');
            loader.innerText = 'Loading...';
            container.appendChild(loader);
            return;
        }

        let input = document.createElement('textarea');
        let feedback = document.createElement('div');

        if (submission.query) {
            let span = document.createElement('span');
            let p = document.createElement('p');
            input.value = submission.query;

            switch (submission.statusId) {
                case 0: {
                    feedback.className = 'feedback pending';
                    span.innerText = 'Pending!';
                    p.innerText = 'We are checking your code...';
                } break;
                case 1:
                case 5: {
                    feedback.className = 'feedback correct';
                    span.innerText = 'Well done!';
                    p.innerText = 'You completed this assignment on ' +
                        new Date(submission.timestamp).toLocaleDateString('nl-NL');
                } break;
                default: {
                    feedback.className = 'feedback wrong';
                    span.innerText = 'Oh snap!';
                    p.innerText = (submission.message || '') +
                        '\n\nChange a few things up and try submitting again.';
                }
            }

            feedback.appendChild(span);
            feedback.appendChild(p);
        }

        let submit = document.createElement('button');
        submit.className = 'submit';
        submit.innerText = 'Submit';
        submit.addEventListener('click', () => {
            let query = input.value;

            if (!query.trim()) return;

            submit.disabled = true;
            submit.innerText = 'Bezig...';

            this.api.sendSubmission(this.aid, this.uid, query)
                .then(result => {
                    // The API checks the query before responding, so the result
                    // is already final. Polling stays as a safety net.
                    this.drawSubmission(container, result);
                    if (result && result.statusId === 0) {
                        this.pollSubmission(container, 5);
                    }
                })
                .catch(() => {
                    submit.disabled = false;
                    submit.innerText = 'Submit';
                    this.drawError(container, 'Je inzending kon niet verstuurd worden. Probeer het opnieuw.');
                });
        });

        container.appendChild(input);
        container.appendChild(submit);
        container.appendChild(feedback);
    }

    pollSubmission(container, ticker) {
        setTimeout(() => {
            this.api.getSubmission(this.aid, this.uid).then(sub => {
                if (sub && sub.statusId !== 0)
                    this.drawSubmission(container, sub);
                else if (ticker > 0)
                    this.pollSubmission(container, ticker - 1);
            }).catch(() => { /* keep the pending state visible */ });
        }, 2000);
    }
}

class DatabApi {
    getAssignment(aid) {
        return fetch(API_URL + aid).then(res => {
            if (!res.ok) throw new Error('Assignment request failed: ' + res.status);
            return res.json();
        });
    }

    getSubmission(aid, uid) {
        return fetch(API_URL + aid + '/submissions/' + encodeURIComponent(uid))
            .then(res => res.status === 204 ? {} : res.json());
    }

    getUserIdFromLocalStorage() {
        let uid = localStorage.getItem('Session.UserId');

        if (!uid) {
            uid = Math.round(Math.random() * 999999);
            localStorage.setItem('Session.UserId', uid);
        }

        return uid;
    }

    sendSubmission(aid, uid, query) {
        return fetch(API_URL + aid + '/submissions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: uid,
                query: query
            })
        }).then(res => {
            if (!res.ok) throw new Error('Submission failed: ' + res.status);
            return res.json();
        });
    }
}

window.customElements.define('wd-datab1', Datab1);
