#pragma once
#include "BTNode.h"

UCLASS()
class UActionBTNode : public UBTNode
{
	GENERATED_BODY()
public:
	TFunction<EBTNodeStatus(UBlackboard*)> Execute;

protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) override
	{
		return Execute ? Execute(Bb) : EBTNodeStatus::Success;
	}
};
