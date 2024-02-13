import information from './information-ideas.json' assert { type: 'json' };
import craft from './craft-structure.json' assert { type: 'json' };
import expression from './expression-ideas.json' assert { type: 'json' };
import standards from './standard-conventions.json' assert { type: 'json' };
const questionTypes = [information,craft,expression,standards];
var json =  '';

document.getElementById('Rationale').style.visibility = 'hidden';
document.getElementById('nextquestion').disabled=true;
document.getElementById('submit').disabled=true;
var selectedAnswer =""
const radios = document.querySelectorAll('input[name="answer"]');
radios.forEach(radio => {
radio.addEventListener('click', function () {
    document.getElementById('submit').disabled=false;
    selectedAnswer = radio.id;
});
});


function buildQuestion(index){
    document.getElementById('questionDiv').style.display = 'block';
    document.getElementById('Rationale').style.visibility = 'hidden';
    document.getElementById('nextquestion').disabled=true;

    document.getElementById('Question').innerHTML=json[index].Question
    document.getElementById('A Button').innerHTML=json[index].A;
    document.getElementById('B Button').innerHTML=json[index].B;
    document.getElementById('C Button').innerHTML=json[index].C;
    document.getElementById('D Button').innerHTML=json[index].D;
    
}


export function submit(){
    document.getElementById('A').disabled=true;
    document.getElementById('B').disabled=true;
    document.getElementById('C').disabled=true;
    document.getElementById('D').disabled=true;
    document.getElementById('submit').disabled=true;
    console.log(selectedAnswer);
    if(selectedAnswer==json[1].Answer){
        console.log("Correct!")
        writeScore(1);
    }
    else{
        writeScore(0);
    }
    document.getElementById('Rationale').style.visibility = 'visible';
    document.getElementById('nextquestion').disabled=false;
    document.getElementById('Rationale').innerHTML = json[1].Rationale;
    
}

export function nextQuestion(){
    json = questionTypes[Math.floor(Math.random()*questionTypes.length)];
    var roll = Math.floor(Math.random()*json.length);
    buildQuestion(roll);
    document.getElementById('A').disabled=false;
    document.getElementById('B').disabled=false;
    document.getElementById('C').disabled=false;
    document.getElementById('D').disabled=false;

    document.getElementById('A').checked=false;
    document.getElementById('B').checked=false;
    document.getElementById('C').checked=false;
    document.getElementById('D').checked=false;

}
window.submit = submit;
window.nextQuestion = nextQuestion;